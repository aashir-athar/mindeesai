#!/usr/bin/env python3
"""
Pretrain the MindeesAI base transformer weights.

This is a reference implementation. It mirrors the architecture in
`core/mindees-mind/model/` exactly (decoder-only, RoPE, RMSNorm, SwiGLU, GQA)
so the resulting checkpoint loads cleanly into the TS runtime.

Output: a binary tensor blob compatible with the TS deserialiser (see
`core/mindees-mind/train/online.ts > persistLoraDelta`'s reverse counterpart,
which is a forward TODO — for now the checkpoint is consumed by `eval.py`).

Usage:
  python pretrain.py --variant small --corpus ../data/corpus.txt --steps 50000
"""

import argparse
import json
import math
import os
import struct
import time
from dataclasses import dataclass
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from tqdm import tqdm

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

VARIANTS = {
    "nano":  Config("nano",  16000,  1024, 256, 6,  4,  4,  768),
    "small": Config("small", 32000,  2048, 512, 8,  8,  4,  1536),
    "base":  Config("base",  50000,  4096, 1024, 12, 16, 8,  2816, rope_base=500000.0),
    "large": Config("large", 64000,  8192, 2048, 24, 32, 8,  5632, rope_base=500000.0),
}

# ─── model ───────────────────────────────────────────────────────────────────

def rms_norm(x: torch.Tensor, weight: torch.Tensor, eps: float) -> torch.Tensor:
    return weight * x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + eps)


def rope(x: torch.Tensor, base: float) -> torch.Tensor:
    # x: (B, T, H, D)
    B, T, H, D = x.shape
    half = D // 2
    freqs = base ** (-torch.arange(0, D, 2, device=x.device).float() / D)
    pos = torch.arange(T, device=x.device).float()
    theta = pos[:, None] * freqs[None, :]            # (T, half)
    cos = theta.cos()[None, :, None, :].to(x.dtype)  # (1, T, 1, half)
    sin = theta.sin()[None, :, None, :].to(x.dtype)
    x_even = x[..., 0::2]
    x_odd  = x[..., 1::2]
    out = torch.empty_like(x)
    out[..., 0::2] = x_even * cos - x_odd * sin
    out[..., 1::2] = x_even * sin + x_odd * cos
    return out


class Attention(nn.Module):
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
        d_head = c.d_model // c.n_heads
        q = self.wq(x).view(B, T, c.n_heads, d_head)
        k = self.wk(x).view(B, T, c.n_kv_heads, d_head)
        v = self.wv(x).view(B, T, c.n_kv_heads, d_head)
        q = rope(q, c.rope_base)
        k = rope(k, c.rope_base)
        # Repeat KV heads to match Q for GQA
        if c.n_kv_heads != c.n_heads:
            repeat = c.n_heads // c.n_kv_heads
            k = k.repeat_interleave(repeat, dim=2)
            v = v.repeat_interleave(repeat, dim=2)
        q = q.transpose(1, 2)  # (B, H, T, D)
        k = k.transpose(1, 2)
        v = v.transpose(1, 2)
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


class Block(nn.Module):
    def __init__(self, cfg: Config):
        super().__init__()
        self.attn_norm = nn.Parameter(torch.ones(cfg.d_model))
        self.attn = Attention(cfg)
        self.ffn_norm = nn.Parameter(torch.ones(cfg.d_model))
        self.ffn = FFN(cfg)
        self.eps = cfg.rms_eps

    def forward(self, x):
        x = x + self.attn(rms_norm(x, self.attn_norm, self.eps))
        x = x + self.ffn(rms_norm(x, self.ffn_norm, self.eps))
        return x


class MindeesMind(nn.Module):
    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        self.emb = nn.Embedding(cfg.vocab_size, cfg.d_model)
        self.blocks = nn.ModuleList([Block(cfg) for _ in range(cfg.n_layers)])
        self.final_norm = nn.Parameter(torch.ones(cfg.d_model))
        self.lm_head = None if cfg.tie_embeddings else nn.Linear(cfg.d_model, cfg.vocab_size, bias=False)

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        x = self.emb(ids)
        for block in self.blocks:
            x = block(x)
        x = rms_norm(x, self.final_norm, self.cfg.rms_eps)
        w = self.emb.weight if self.cfg.tie_embeddings else self.lm_head.weight
        return x @ w.t()


# ─── data ────────────────────────────────────────────────────────────────────

def load_tokens(corpus_path: str, tokenizer_path: str) -> torch.Tensor:
    text = Path(corpus_path).read_text(encoding="utf-8", errors="replace")
    tk = json.loads(Path(tokenizer_path).read_text(encoding="utf-8"))
    vocab = [base64_decode(v) for v in tk["vocab"]]
    merges = [tuple(m) for m in tk["merges"]]
    by_pair = {(l, r): m for (l, r, m) in merges}
    first_byte_id = 8  # specials occupy 0..7
    ids: list[int] = []
    for byte in text.encode("utf-8"):
        ids.append(first_byte_id + byte)
    # Greedy merges
    merged = True
    while merged:
        merged = False
        i = 0
        while i < len(ids) - 1:
            m = by_pair.get((ids[i], ids[i + 1]))
            if m is not None:
                ids[i : i + 2] = [m]
                merged = True
            else:
                i += 1
    return torch.tensor(ids, dtype=torch.long)


def base64_decode(s: str) -> bytes:
    import base64 as _b
    return _b.b64decode(s)


# ─── checkpoint i/o ──────────────────────────────────────────────────────────

def save_checkpoint(model: MindeesMind, path: str):
    """Write a flat binary blob matching the TS deserialiser format.
       MAGIC[4]=b'MIND' n_tensors[u32] then per tensor:
         name_len[u16] name[utf-8] shape_len[u8] shape[u32 × N] data[f32 × size]
    """
    state = model.state_dict()
    with open(path, "wb") as f:
        f.write(b"MIND")
        f.write(struct.pack("<I", len(state)))
        for name, tensor in state.items():
            name_bytes = name.encode("utf-8")
            f.write(struct.pack("<H", len(name_bytes)))
            f.write(name_bytes)
            shape = tensor.shape
            f.write(struct.pack("<B", len(shape)))
            for dim in shape:
                f.write(struct.pack("<I", dim))
            f.write(tensor.detach().cpu().float().numpy().tobytes())
    print(f"saved {path} ({os.path.getsize(path) / 1024 / 1024:.1f} MB)")


# ─── training loop ───────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=list(VARIANTS), default="small")
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--tokenizer", default="../../tokenizer/tokenizer.json")
    ap.add_argument("--steps", type=int, default=50000)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--out", default="../../checkpoints/base.bin")
    args = ap.parse_args()

    cfg = VARIANTS[args.variant]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device={device}  variant={cfg.variant}")

    print("loading + tokenising corpus…")
    tokens = load_tokens(args.corpus, args.tokenizer).to(device)
    print(f"corpus size: {len(tokens):,} tokens")

    model = MindeesMind(cfg).to(device)
    optim = torch.optim.AdamW(model.parameters(), lr=args.lr, betas=(0.9, 0.95), weight_decay=0.1)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(optim, T_max=args.steps, eta_min=args.lr * 0.1)

    bar = tqdm(range(args.steps))
    for step in bar:
        # Random contiguous windows from the corpus
        idx = torch.randint(0, len(tokens) - cfg.context_length - 1, (args.batch,), device=device)
        x = torch.stack([tokens[i : i + cfg.context_length] for i in idx])
        y = torch.stack([tokens[i + 1 : i + cfg.context_length + 1] for i in idx])
        logits = model(x)
        loss = F.cross_entropy(logits.view(-1, cfg.vocab_size), y.view(-1))
        optim.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optim.step()
        sched.step()
        bar.set_postfix(loss=float(loss), lr=sched.get_last_lr()[0])
        if step > 0 and step % 5000 == 0:
            save_checkpoint(model, args.out)

    save_checkpoint(model, args.out)


if __name__ == "__main__":
    main()
