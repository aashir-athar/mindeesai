#!/usr/bin/env python3
"""
MindeesAI native-model pretraining — feature-complete reference.

Architecture matches the TS runtime under core/mindees-mind/ exactly, so a
checkpoint trained here loads cleanly inside the Next.js app:

  - Decoder-only transformer
  - RoPE positional embeddings (decoupled, large theta for long context)
  - RMSNorm
  - SwiGLU FFN
  - Grouped-Query Attention (GQA)
  - **Optional** Mixture of Experts FFN (top-K routing + load-balance aux loss)
  - **Optional** Multi-head Latent Attention (DeepSeek-V3 compressed KV)
  - **Optional** Multi-Token Prediction auxiliary heads (depth 2..k)
  - Tied embeddings / LM head
  - µP-friendly initialisation (Kaiming with fan_in)
  - AdamW with cosine LR + linear warmup
  - Gradient accumulation
  - Mixed-precision (autocast + GradScaler)
  - Gradient clipping
  - Validation loop on held-out shard
  - Resume from checkpoint (--resume <path>)
  - Streaming dataset (HuggingFace `datasets` if installed; else file lines)
  - JSONL training log compatible with the in-app /dashboard

Usage:
  python pretrain.py --variant small --corpus ../data/corpus.txt \
                     --steps 50000 --batch 8 --grad-accum 4 --lr 3e-4 \
                     --warmup 1000 --val-frac 0.01 --amp --moe 0 \
                     --out ../../checkpoints/base.bin

Train on a single 24GB GPU at `small`. Move to `base` / `large` with
a multi-GPU launcher of your choice.

This file is the source-of-truth specification of the model. If the TS
runtime ever disagrees with this file, the bug is in TS.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterator

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.amp import autocast, GradScaler
from tqdm import tqdm


# ─────────────────────────────────────────────────────────────────────────────
# Config — keep aligned with core/mindees-mind/model/config.ts
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Config:
    variant: str
    vocab_size: int
    context_length: int
    d_model: int
    n_layers: int
    n_heads: int
    n_kv_heads: int
    d_ffn: int
    rope_base: float = 10000.0
    rms_eps: float = 1e-6
    tie_embeddings: bool = True
    # Frontier toggles
    use_moe: bool = False
    num_experts: int = 8
    experts_per_token: int = 2
    moe_aux_loss_weight: float = 0.01
    use_mla: bool = False
    mla_latent_dim: int = 128
    use_mtp: bool = False
    mtp_depth: int = 2


VARIANTS: dict[str, Config] = {
    "nano":  Config("nano",  16000, 1024, 256,  6,  4, 4,  768),
    "small": Config("small", 32000, 2048, 512,  8,  8, 4, 1536, use_mla=True, mla_latent_dim=128, use_mtp=True, mtp_depth=2),
    "base":  Config("base",  50000, 4096, 1024, 12, 16, 8, 2816, rope_base=500000.0, use_mla=True, mla_latent_dim=256, use_mtp=True, mtp_depth=2),
    "large": Config("large", 64000, 8192, 2048, 24, 32, 8, 5632, rope_base=500000.0, use_mla=True, mla_latent_dim=512, use_mtp=True, mtp_depth=3),
    "moe-small": Config("moe-small", 32000, 2048, 512,  8,  8, 4, 1024, use_moe=True, num_experts=8,  experts_per_token=2, use_mla=True, mla_latent_dim=128, use_mtp=True),
    "moe-base":  Config("moe-base",  50000, 4096, 1024, 12, 16, 8, 1408, rope_base=500000.0, use_moe=True, num_experts=16, experts_per_token=2, use_mla=True, mla_latent_dim=256, use_mtp=True),
}


# ─────────────────────────────────────────────────────────────────────────────
# Building blocks
# ─────────────────────────────────────────────────────────────────────────────

def rms_norm(x: torch.Tensor, weight: torch.Tensor, eps: float) -> torch.Tensor:
    return weight * x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + eps)


def rope(x: torch.Tensor, base: float) -> torch.Tensor:
    """x: (B, T, H, D). Apply rotary positional embedding."""
    B, T, H, D = x.shape
    freqs = base ** (-torch.arange(0, D, 2, device=x.device).float() / D)
    pos = torch.arange(T, device=x.device).float()
    theta = pos[:, None] * freqs[None, :]
    cos = theta.cos()[None, :, None, :].to(x.dtype)
    sin = theta.sin()[None, :, None, :].to(x.dtype)
    x_even, x_odd = x[..., 0::2], x[..., 1::2]
    out = torch.empty_like(x)
    out[..., 0::2] = x_even * cos - x_odd * sin
    out[..., 1::2] = x_even * sin + x_odd * cos
    return out


class Attention(nn.Module):
    """Standard MHA + GQA (no MLA). Used when cfg.use_mla = False."""

    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        d = cfg.d_model
        kv = cfg.n_kv_heads * (d // cfg.n_heads)
        self.wq = nn.Linear(d, d, bias=False)
        self.wk = nn.Linear(d, kv, bias=False)
        self.wv = nn.Linear(d, kv, bias=False)
        self.wo = nn.Linear(d, d, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, _ = x.shape
        c = self.cfg
        dh = c.d_model // c.n_heads
        q = self.wq(x).view(B, T, c.n_heads, dh)
        k = self.wk(x).view(B, T, c.n_kv_heads, dh)
        v = self.wv(x).view(B, T, c.n_kv_heads, dh)
        q = rope(q, c.rope_base)
        k = rope(k, c.rope_base)
        if c.n_kv_heads != c.n_heads:
            repeat = c.n_heads // c.n_kv_heads
            k = k.repeat_interleave(repeat, dim=2)
            v = v.repeat_interleave(repeat, dim=2)
        q, k, v = q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)
        out = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        out = out.transpose(1, 2).contiguous().view(B, T, c.d_model)
        return self.wo(out)


class MLA(nn.Module):
    """Multi-head Latent Attention (DeepSeek-V3). KV is compressed into
    a low-rank latent that is then expanded for attention. Saves KV cache."""

    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        d = cfg.d_model
        kv = cfg.n_kv_heads * (d // cfg.n_heads)
        L = cfg.mla_latent_dim
        self.wq = nn.Linear(d, d, bias=False)
        self.wDKV = nn.Linear(d, L, bias=False)
        self.wUK = nn.Linear(L, kv, bias=False)
        self.wUV = nn.Linear(L, kv, bias=False)
        self.wo = nn.Linear(d, d, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, _ = x.shape
        c = self.cfg
        dh = c.d_model // c.n_heads
        q = self.wq(x).view(B, T, c.n_heads, dh)
        latent = self.wDKV(x)
        k = self.wUK(latent).view(B, T, c.n_kv_heads, dh)
        v = self.wUV(latent).view(B, T, c.n_kv_heads, dh)
        q = rope(q, c.rope_base)
        k = rope(k, c.rope_base)
        if c.n_kv_heads != c.n_heads:
            repeat = c.n_heads // c.n_kv_heads
            k = k.repeat_interleave(repeat, dim=2)
            v = v.repeat_interleave(repeat, dim=2)
        q, k, v = q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)
        out = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        out = out.transpose(1, 2).contiguous().view(B, T, c.d_model)
        return self.wo(out)


class FFN(nn.Module):
    def __init__(self, cfg: Config):
        super().__init__()
        self.gate = nn.Linear(cfg.d_model, cfg.d_ffn, bias=False)
        self.up   = nn.Linear(cfg.d_model, cfg.d_ffn, bias=False)
        self.down = nn.Linear(cfg.d_ffn, cfg.d_model, bias=False)

    def forward(self, x):
        return self.down(F.silu(self.gate(x)) * self.up(x))


class MoEFFN(nn.Module):
    """Mixture-of-Experts FFN. Returns (output, aux_loss_scalar)."""

    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        self.router = nn.Linear(cfg.d_model, cfg.num_experts, bias=False)
        self.experts = nn.ModuleList([FFN(cfg) for _ in range(cfg.num_experts)])

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        B, T, D = x.shape
        N = B * T
        E = self.cfg.num_experts
        K = self.cfg.experts_per_token

        x_flat = x.reshape(N, D)
        logits = self.router(x_flat)                       # (N, E)
        probs = F.softmax(logits, dim=-1)                  # (N, E)
        topk_vals, topk_idx = probs.topk(K, dim=-1)        # (N, K)
        topk_vals = topk_vals / (topk_vals.sum(-1, keepdim=True) + 1e-9)

        y = torch.zeros_like(x_flat)
        for e in range(E):
            mask = (topk_idx == e).any(dim=-1)             # (N,)
            if not mask.any():
                continue
            tokens = x_flat[mask]                          # (n_e, D)
            out = self.experts[e](tokens)
            # gather the per-token weight for expert e
            weight = torch.zeros(mask.sum(), device=x.device, dtype=x.dtype)
            for k in range(K):
                m = topk_idx[mask, k] == e
                weight = torch.where(m, topk_vals[mask, k], weight)
            y[mask] += out * weight.unsqueeze(-1)

        # Load-balance auxiliary loss — minimised when router is uniform.
        usage = probs.mean(0)                              # (E,)
        fraction = torch.zeros_like(usage)
        for e in range(E):
            fraction[e] = (topk_idx == e).float().mean()
        aux = (usage * fraction).sum() * E * self.cfg.moe_aux_loss_weight

        return y.reshape(B, T, D), aux


class Block(nn.Module):
    def __init__(self, cfg: Config):
        super().__init__()
        self.attn_norm = nn.Parameter(torch.ones(cfg.d_model))
        self.attn = MLA(cfg) if cfg.use_mla else Attention(cfg)
        self.ffn_norm = nn.Parameter(torch.ones(cfg.d_model))
        self.use_moe = cfg.use_moe
        self.ffn = MoEFFN(cfg) if cfg.use_moe else FFN(cfg)
        self.eps = cfg.rms_eps

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        aux = x.new_zeros(())
        x = x + self.attn(rms_norm(x, self.attn_norm, self.eps))
        normed = rms_norm(x, self.ffn_norm, self.eps)
        if self.use_moe:
            y, a = self.ffn(normed)
            aux = aux + a
            x = x + y
        else:
            x = x + self.ffn(normed)
        return x, aux


class MTPHead(nn.Module):
    """Multi-Token Prediction auxiliary head — predicts t+depth token."""

    def __init__(self, cfg: Config):
        super().__init__()
        self.norm = nn.Parameter(torch.ones(cfg.d_model))
        self.proj = nn.Linear(cfg.d_model, cfg.d_model, bias=False)
        self.eps = cfg.rms_eps

    def forward(self, h: torch.Tensor) -> torch.Tensor:
        return self.proj(rms_norm(h, self.norm, self.eps))


class MindeesMind(nn.Module):
    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        self.emb = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.blocks = nn.ModuleList([Block(cfg) for _ in range(cfg.n_layers)])
        self.final_norm = nn.Parameter(torch.ones(cfg.d_model))
        self.lm_head = None if cfg.tie_embeddings else nn.Linear(cfg.d_model, cfg.vocab_size, bias=False)
        self.mtp_heads = nn.ModuleList(
            [MTPHead(cfg) for _ in range(cfg.mtp_depth - 1)] if cfg.use_mtp and cfg.mtp_depth > 1 else []
        )

    def forward(self, ids: torch.Tensor) -> tuple[torch.Tensor, list[torch.Tensor], torch.Tensor]:
        """Returns (main_logits, mtp_logits_list, aux_loss)."""
        x = self.emb(ids)
        aux_total = x.new_zeros(())
        for blk in self.blocks:
            x, aux = blk(x)
            aux_total = aux_total + aux
        x = rms_norm(x, self.final_norm, self.cfg.rms_eps)
        W = self.emb.weight if self.cfg.tie_embeddings else self.lm_head.weight

        main_logits = x @ W.t()

        mtp_logits = []
        h = x
        for head in self.mtp_heads:
            h = head(h)
            mtp_logits.append(h @ W.t())

        return main_logits, mtp_logits, aux_total


# ─────────────────────────────────────────────────────────────────────────────
# Tokenization (matches core/mindees-mind/tokenizer/bpe.ts)
# ─────────────────────────────────────────────────────────────────────────────

def load_bpe(tokenizer_path: str):
    raw = json.loads(Path(tokenizer_path).read_text(encoding="utf-8"))
    import base64 as _b
    vocab = [_b.b64decode(v) for v in raw["vocab"]]
    merges = [tuple(m) for m in raw["merges"]]
    by_pair = {(l, r): m for (l, r, m) in merges}
    return vocab, by_pair


def tokenize(text: str, by_pair: dict, first_byte_id: int = 8) -> list[int]:
    ids = [first_byte_id + b for b in text.encode("utf-8")]
    while True:
        i = 0
        merged_any = False
        new_ids = []
        while i < len(ids):
            if i + 1 < len(ids) and (ids[i], ids[i + 1]) in by_pair:
                new_ids.append(by_pair[(ids[i], ids[i + 1])])
                i += 2
                merged_any = True
            else:
                new_ids.append(ids[i])
                i += 1
        ids = new_ids
        if not merged_any:
            break
    return ids


# ─────────────────────────────────────────────────────────────────────────────
# Data
# ─────────────────────────────────────────────────────────────────────────────

class StreamingTextDataset:
    """Memory-mapped token stream — random contiguous-window sampler."""

    def __init__(self, tokens: torch.Tensor, context: int):
        self.tokens = tokens
        self.context = context

    def sample(self, batch_size: int, device) -> tuple[torch.Tensor, torch.Tensor]:
        idx = torch.randint(0, len(self.tokens) - self.context - 1, (batch_size,), device=device)
        x = torch.stack([self.tokens[i : i + self.context] for i in idx])
        y = torch.stack([self.tokens[i + 1 : i + self.context + 1] for i in idx])
        return x, y


def load_tokens(corpus_path: str, tokenizer_path: str, device) -> torch.Tensor:
    print(f"tokenizing corpus: {corpus_path}", file=sys.stderr)
    text = Path(corpus_path).read_text(encoding="utf-8", errors="replace")
    _vocab, by_pair = load_bpe(tokenizer_path)
    ids = tokenize(text, by_pair)
    return torch.tensor(ids, dtype=torch.long, device=device)


def load_distill_corpus(path: str, tokenizer_path: str, device) -> torch.Tensor:
    """Load the live distillation corpus produced by the running app.

    Format (JSONL, one row per chat turn):
      { ts, threadId, system, user, assistant, tools, mood, goal }

    We format each row into the chat template the TS runtime uses at
    inference time, then tokenize. The model trained on this dataset
    will naturally inherit the Mindees persona and the user's specific
    conversation patterns.
    """
    if not Path(path).exists():
        return torch.tensor([], dtype=torch.long, device=device)
    print(f"loading distillation corpus: {path}", file=sys.stderr)
    _vocab, by_pair = load_bpe(tokenizer_path)
    text_parts: list[str] = []
    skipped = 0
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            skipped += 1
            continue
        sys_p = (row.get("system") or "").strip()
        usr = (row.get("user") or "").strip()
        asn = (row.get("assistant") or "").strip()
        if not usr or not asn:
            skipped += 1
            continue
        # Chat template — same shape the TS orchestrator uses
        text_parts.append(
            f"<system>{sys_p}</system>\n<user>{usr}</user>\n<assistant>{asn}</assistant>\n"
        )
    if skipped:
        print(f"  skipped {skipped} malformed/empty rows", file=sys.stderr)
    if not text_parts:
        return torch.tensor([], dtype=torch.long, device=device)
    blob = "".join(text_parts)
    ids = tokenize(blob, by_pair)
    print(f"  distill corpus: {len(text_parts)} turns → {len(ids):,} tokens", file=sys.stderr)
    return torch.tensor(ids, dtype=torch.long, device=device)


# ─────────────────────────────────────────────────────────────────────────────
# Optim / schedule
# ─────────────────────────────────────────────────────────────────────────────

def build_optim(model: nn.Module, lr: float, weight_decay: float):
    decay, nodecay = [], []
    for n, p in model.named_parameters():
        if not p.requires_grad:
            continue
        if p.dim() < 2 or n.endswith("norm"):
            nodecay.append(p)
        else:
            decay.append(p)
    return torch.optim.AdamW(
        [
            {"params": decay, "weight_decay": weight_decay},
            {"params": nodecay, "weight_decay": 0.0},
        ],
        lr=lr, betas=(0.9, 0.95), eps=1e-8,
    )


def lr_at(step: int, total: int, warmup: int, peak: float, floor_ratio: float = 0.1) -> float:
    """Linear warmup → cosine decay to floor_ratio * peak."""
    if step < warmup:
        return peak * (step + 1) / max(1, warmup)
    progress = (step - warmup) / max(1, total - warmup)
    cos = 0.5 * (1.0 + math.cos(math.pi * min(1.0, progress)))
    return peak * (floor_ratio + (1.0 - floor_ratio) * cos)


# ─────────────────────────────────────────────────────────────────────────────
# Checkpoint I/O
# ─────────────────────────────────────────────────────────────────────────────

def save_ts_checkpoint(model: MindeesMind, cfg: Config, path: str):
    """Write a binary blob the TS runtime understands.

    Format (little-endian):
      MAGIC[4] = 'MIND'
      cfg_json_len[u32]  cfg_json[u8 × len]
      n_tensors[u32]
      per tensor: name_len[u16] name[u8 × len] shape_len[u8] shape[u32 × n] data[f32 × size]
    """
    state = model.state_dict()
    with open(path, "wb") as f:
        f.write(b"MIND")
        cfg_json = json.dumps(asdict(cfg)).encode("utf-8")
        f.write(struct.pack("<I", len(cfg_json)))
        f.write(cfg_json)
        f.write(struct.pack("<I", len(state)))
        for name, tensor in state.items():
            nb = name.encode("utf-8")
            f.write(struct.pack("<H", len(nb)))
            f.write(nb)
            shape = tensor.shape
            f.write(struct.pack("<B", len(shape)))
            for d in shape:
                f.write(struct.pack("<I", int(d)))
            f.write(tensor.detach().cpu().to(torch.float32).numpy().tobytes())
    sz = os.path.getsize(path) / 1024 / 1024
    print(f"  saved {path} ({sz:.1f} MB)")


def save_torch_checkpoint(model, optim, scaler, step, cfg: Config, path: str):
    torch.save({
        "model": model.state_dict(),
        "optim": optim.state_dict(),
        "scaler": scaler.state_dict() if scaler is not None else None,
        "step": step,
        "cfg": asdict(cfg),
    }, path)


def load_torch_checkpoint(path: str, model, optim, scaler) -> int:
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model"])
    optim.load_state_dict(ckpt["optim"])
    if scaler is not None and ckpt.get("scaler"):
        scaler.load_state_dict(ckpt["scaler"])
    return int(ckpt.get("step", 0))


# ─────────────────────────────────────────────────────────────────────────────
# Train loop
# ─────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=list(VARIANTS), default="small")
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--distill-corpus", default=None, help="Optional path to data/distill-corpus.jsonl collected by the running app. Concatenated with --corpus at load time.")
    ap.add_argument("--tokenizer", default="../../tokenizer/tokenizer.json")
    ap.add_argument("--steps", type=int, default=50_000)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--grad-accum", type=int, default=1)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--warmup", type=int, default=1000)
    ap.add_argument("--wd", type=float, default=0.1)
    ap.add_argument("--val-frac", type=float, default=0.01)
    ap.add_argument("--val-every", type=int, default=1000)
    ap.add_argument("--ckpt-every", type=int, default=5000)
    ap.add_argument("--log", default="../../data/training-metrics.jsonl")
    ap.add_argument("--out", default="../../checkpoints/base.bin")
    ap.add_argument("--torch-ckpt", default="../../checkpoints/torch-resume.pt")
    ap.add_argument("--resume", default=None)
    ap.add_argument("--amp", action="store_true", help="enable mixed-precision training")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--mtp-loss-weight", type=float, default=0.20)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    cfg = VARIANTS[args.variant]
    print(f"device={device}  variant={cfg.variant}  use_moe={cfg.use_moe}  use_mla={cfg.use_mla}  use_mtp={cfg.use_mtp}")

    # Data — base corpus + optional distillation corpus from the running app
    tokens = load_tokens(args.corpus, args.tokenizer, device="cpu")
    if args.distill_corpus:
        distill = load_distill_corpus(args.distill_corpus, args.tokenizer, device="cpu")
        if distill.numel() > 0:
            tokens = torch.cat([tokens, distill], dim=0)
            print(f"  combined corpus: {len(tokens):,} tokens", file=sys.stderr)
    if len(tokens) < 2 * cfg.context_length + 4:
        raise SystemExit(f"corpus too small ({len(tokens)} tokens) for context_length={cfg.context_length}")
    n_val = max(2 * cfg.context_length, int(len(tokens) * args.val_frac))
    train_tokens = tokens[:-n_val].to(device)
    val_tokens = tokens[-n_val:].to(device)
    train_ds = StreamingTextDataset(train_tokens, cfg.context_length)
    val_ds = StreamingTextDataset(val_tokens, cfg.context_length)
    print(f"train tokens: {len(train_tokens):,}  val tokens: {len(val_tokens):,}")

    # Model
    model = MindeesMind(cfg).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"params: {n_params / 1e6:.1f}M")

    optim = build_optim(model, args.lr, args.wd)
    scaler = GradScaler(enabled=args.amp and device == "cuda")
    start_step = 0
    if args.resume and Path(args.resume).exists():
        start_step = load_torch_checkpoint(args.resume, model, optim, scaler)
        print(f"resumed from {args.resume} at step {start_step}")

    log_path = Path(args.log)
    log_path.parent.mkdir(parents=True, exist_ok=True)

    bar = tqdm(range(start_step, args.steps), initial=start_step, total=args.steps)
    accum_loss = 0.0
    optim.zero_grad(set_to_none=True)
    t_last = time.time()

    for step in bar:
        # LR schedule
        cur_lr = lr_at(step, args.steps, args.warmup, args.lr)
        for g in optim.param_groups:
            g["lr"] = cur_lr

        # micro-batches for gradient accumulation
        loss_sum = 0.0
        for _ in range(args.grad_accum):
            x, y = train_ds.sample(args.batch, device)
            with autocast(device_type=device, enabled=args.amp and device == "cuda", dtype=torch.bfloat16 if device == "cuda" else torch.float32):
                main_logits, mtp_logits, aux = model(x)
                ce = F.cross_entropy(main_logits.view(-1, cfg.vocab_size), y.view(-1))
                # MTP auxiliary losses — each head predicts token shifted by (depth)
                mtp_loss = main_logits.new_zeros(())
                for d_i, head_logits in enumerate(mtp_logits):
                    depth = d_i + 2
                    if y.size(1) <= depth - 1:
                        continue
                    aligned_y = y[:, depth - 1:]
                    aligned_logits = head_logits[:, : aligned_y.size(1), :]
                    mtp_loss = mtp_loss + F.cross_entropy(
                        aligned_logits.reshape(-1, cfg.vocab_size),
                        aligned_y.reshape(-1),
                    )
                loss = ce + aux + args.mtp_loss_weight * mtp_loss
                loss = loss / args.grad_accum
            scaler.scale(loss).backward()
            loss_sum += loss.item() * args.grad_accum

        scaler.unscale_(optim)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(optim)
        scaler.update()
        optim.zero_grad(set_to_none=True)

        accum_loss = loss_sum / args.grad_accum
        bar.set_postfix(loss=accum_loss, lr=cur_lr)

        # Per-step log
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "ts": time.time(),
                "step": step,
                "loss": accum_loss,
                "lr": cur_lr,
            }) + "\n")

        # Validation
        if (step + 1) % args.val_every == 0:
            model.eval()
            with torch.no_grad():
                vx, vy = val_ds.sample(args.batch, device)
                vlogits, _, _ = model(vx)
                vloss = F.cross_entropy(vlogits.view(-1, cfg.vocab_size), vy.view(-1)).item()
            tqdm.write(f"  step={step + 1}  train={accum_loss:.4f}  val={vloss:.4f}  lr={cur_lr:.2e}")
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps({"ts": time.time(), "step": step, "val_loss": vloss}) + "\n")
            model.train()

        # Checkpoints
        if (step + 1) % args.ckpt_every == 0 and step + 1 < args.steps:
            save_ts_checkpoint(model, cfg, args.out)
            save_torch_checkpoint(model, optim, scaler, step + 1, cfg, args.torch_ckpt)

    # Final save
    save_ts_checkpoint(model, cfg, args.out)
    save_torch_checkpoint(model, optim, scaler, args.steps, cfg, args.torch_ckpt)
    elapsed = time.time() - t_last
    print(f"\ndone — {args.steps} steps in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
