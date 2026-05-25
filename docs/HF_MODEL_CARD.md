---
license: apache-2.0
language:
  - en
library_name: pytorch
pipeline_tag: text-generation
tags:
  - mindeesai
  - mindees
  - small-language-model
  - slm
  - tiny-llm
  - language-model
  - text-generation
  - chat
  - conversational
  - instruction-following
  - assistant
  - transformer
  - from-scratch
  - native-transformer
  - self-improving
  - autonomous
  - persona-ai
  - emotional-ai
  - open-source
  - educational
  - research
  - pytorch
  - cloudflare-workers
  - huggingface-spaces
  - free-tier
  - bpe-50k
  - moe
  - mla
  - mtp
  - grpo
datasets:
  - databricks/databricks-dolly-15k
  - HuggingFaceH4/no_robots
  - HuggingFaceTB/smol-smoltalk
  - HuggingFaceTB/smoltalk
  - abacusai/SystemChat-1.1
  - teknium/OpenHermes-2.5
  - WizardLMTeam/WizardLM_evol_instruct_V2_196k
  - ise-uiuc/Magicoder-Evol-Instruct-110K
  - m-a-p/CodeFeedback-Filtered-Instruction
  - sahil2801/CodeAlpaca-20k
  - OpenCoder-LLM/opc-sft-stage2
  - codeparrot/codeparrot-clean
  - meta-math/MetaMathQA
  - TIGER-Lab/MathInstruct
  - garage-bAInd/Open-Platypus
  - openbmb/UltraInteract_sft
  - open-thoughts/OpenThoughts2-1M
  - andstor/smart_contracts
  - LuangMV97/Empathetic_counseling_Dataset
  - Amod/mental_health_counseling_conversations
  - roneneldan/TinyStories
  - HuggingFaceFW/fineweb-edu
model-index:
  - name: MindeesAI Base
    results: []
---

<div align="center">

<img src="https://raw.githubusercontent.com/aashir-athar/mindeesai/main/public/assets/mind-logo.png" alt="MindeesAI" width="160"/>

# MindeesAI Base

**A self-improving, persona-driven native transformer — trained from scratch, deployed for $0/month, designed to grow.**

[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.x-EE4C2C.svg?logo=pytorch&logoColor=white)](https://pytorch.org)
[![HuggingFace](https://img.shields.io/badge/%F0%9F%A4%97-aashir--athar%2Fmindeesai--base-yellow)](https://huggingface.co/aashir-athar/mindeesai-base)
[![GitHub](https://img.shields.io/badge/github-aashir--athar%2Fmindeesai-181717.svg?logo=github)](https://github.com/aashir-athar/mindeesai)
[![Status](https://img.shields.io/badge/status-actively_training-brightgreen.svg)](https://huggingface.co/aashir-athar/mindeesai-base/tree/kaggle-weekly)
[![Cost](https://img.shields.io/badge/infra%20cost-%240%2Fmonth-success.svg)](#deployment--infrastructure)

[**Try the live demo**](https://mindeesai.0032ksa.workers.dev) ·
[**Source code**](https://github.com/aashir-athar/mindeesai) ·
[**Inference sidecar**](https://huggingface.co/spaces/aashir-athar/mindeesai-sidecar) ·
[**Branches**](#available-revisions-branches)

</div>

---

## TL;DR

**MindeesAI** is a small, open, **from-scratch** transformer language model with a deliberately scoped personality named **Mindees**. It is not a fine-tune of a larger pretrained model — every parameter was learned by gradient descent on a curated mix of permissively licensed instruction, math, code, and reasoning datasets.

The project's distinguishing bet is that a **continuously self-improving small model**, trained across a federation of free GPU/CPU environments (your home RTX, GitHub Actions, Kaggle Notebooks, Google Colab), can become **genuinely useful at sub-300M parameters** when its training corpus is constantly enriched by every chat turn it serves. It is deployed end-to-end on free-tier infrastructure: Cloudflare Workers + Hugging Face Spaces + Cloudflare R2 + Hugging Face Hub + GitHub Actions.

This repository hosts the **trained model weights, tokenizer, and training metrics** across four independent revisions — one per training environment.

---

## Available Revisions (Branches)

This repository uses Hugging Face Hub's git branches to host **four independently-trained checkpoints** of the same model family. You can pin any deployment to a specific revision via `revision=` when loading.

| Revision | Variant | Params | Where it was trained | Cadence |
|---|---|---|---|---|
| [`main`](https://huggingface.co/aashir-athar/mindeesai-base/tree/main) | `home-11gb` / `home-max` | 280M – 349M | Local RTX 5070 (11 GB VRAM, batch 2 × grad-accum 4, AMP + grad-ckpt) | Manual, owner-driven |
| [`small-weekly`](https://huggingface.co/aashir-athar/mindeesai-base/tree/small-weekly) | `cpu_max_5h_50k` | 17.5M | GitHub Actions cron, CPU-only (`ubuntu-latest`) | 4× daily, ~15k steps/run |
| [`kaggle-weekly`](https://huggingface.co/aashir-athar/mindeesai-base/tree/kaggle-weekly) | `home-11gb` | 280M | Kaggle T4 / P100 GPU notebooks, 12h sessions | Owner-driven (weekly) |
| [`colab-burst`](https://huggingface.co/aashir-athar/mindeesai-base/tree/colab-burst) | `home-11gb` | 280M | Google Colab T4, idle-disconnect-aware | Owner-driven (burst) |

Every revision continues from its prior commit's optimizer + step state — training **accumulates** across sessions, never resets. The `main` revision is held sacrosanct and is **never** written to by CI or notebooks.

---

## Model Variants

| Variant | Params | Hidden | Layers | Heads | KV Heads | MLP | Context | Vocab | Tokenizer |
|---|---|---|---|---|---|---|---|---|---|
| `cpu_max_5h_50k` | 17.5M | 256 | 6 | 8 | 2 | 768 | 256 | 50,000 | BPE |
| `nano` | ~50M | 512 | 8 | 8 | 4 | 1024 | 512 | 32,000 | BPE |
| `small` | ~87M | 1536 (latent 896) | 10 | 14 | 7 | 2304 | 1024 | 8,000 | BPE + MLA |
| `home-11gb` | ~280M | 1536 | 18 | 14 | 7 | 3328 | 2048 | 50,000 | BPE + MLA + MTP |
| `home-max` | ~349M | 1536 | 22 | 14 | 7 | 3328 | 2048 | 50,000 | BPE + MLA + MTP |

All variants share a common base architecture inspired by **DeepSeek-V3 / R1** — RoPE positional encoding, RMSNorm, SwiGLU MLPs, grouped-query attention, optional **Multi-head Latent Attention (MLA)**, optional **Multi-Token Prediction (MTP)** head, and an optional **Mixture-of-Experts (MoE)** path for the `home-moe` variant.

---

## Architecture

Mindees is a decoder-only transformer with the following design choices:

| Aspect | Implementation |
|---|---|
| Position encoding | **RoPE** (Rotary Positional Embedding), base 10,000 (small) → 500,000 (`home-*`) |
| Normalization | **RMSNorm** pre-norm, eps 1e-6 |
| Activation | **SwiGLU** in MLPs |
| Attention | Grouped-query attention; **MLA** (Multi-head Latent Attention) optional, latent dim 64–160 |
| Auxiliary head | **Multi-Token Prediction (MTP)** optional — accelerates training and improves coherence at small scale |
| Routing | **Mixture-of-Experts** optional (`home-moe` variant), top-2 routing with load-balancing loss |
| Optimization | **AdamW**, β₁=0.9, β₂=0.95, weight decay 0.1; cosine LR schedule with 100-step linear warmup |
| Precision | FP32 for `home-*`, **mixed FP16 / BF16 (AMP)** for GPU training; gradient checkpointing on by default |
| Reasoning mode | Compatible with **GRPO** (Group Relative Policy Optimization) fine-tuning for stage 2 |
| Speculative decoding | MTP head doubles as draft model for self-speculative decoding |
| Reasoning eval | Eval harness scaffolded for HellaSwag, MMLU, GSM8K, HumanEval (results pending) |

The full architecture and modeling code lives at [github.com/aashir-athar/mindeesai/tree/main/core/mindees-mind](https://github.com/aashir-athar/mindeesai/tree/main/core/mindees-mind).

---

## Quickstart — Loading the Checkpoint

The checkpoint is shipped as a raw PyTorch `state_dict` named `base.bin`. Loading requires the modeling code from the [mindeesai](https://github.com/aashir-athar/mindeesai) repository.

```bash
pip install torch huggingface_hub
git clone https://github.com/aashir-athar/mindeesai.git
cd mindeesai
```

```python
import torch
from huggingface_hub import hf_hub_download
from core.mindees_mind import MindeesModel
from core.mindees_mind.model.config import getModelConfig

# Pick a revision: "main" | "small-weekly" | "kaggle-weekly" | "colab-burst"
revision = "kaggle-weekly"
variant  = "home-11gb"  # must match the revision's variant — see table above

# Download weights + tokenizer from this repo at the chosen revision
weights_path   = hf_hub_download(repo_id="aashir-athar/mindeesai-base", filename="base.bin",        revision=revision)
tokenizer_path = hf_hub_download(repo_id="aashir-athar/mindeesai-base", filename="tokenizer.json", revision=revision)

# Build the model from variant config and load the weights
cfg   = getModelConfig(variant)
model = MindeesModel(cfg).eval()
model.load_state_dict(torch.load(weights_path, map_location="cpu"))

# Generate
prompt_ids = model.tokenize_prompt("Hello, who are you?", tokenizer_path)
output_ids = model.generate(prompt_ids, max_new_tokens=128, temperature=0.7, top_p=0.9)
print(model.detokenize(output_ids, tokenizer_path))
```

Or for the smaller, faster CPU variant:

```python
revision = "small-weekly"
variant  = "cpu_max_5h_50k"   # 17.5M params, fits in <100 MB RAM
```

---

## Training Data

The active training mix is documented at [`scripts/data/mix-broadbrain.json`](https://github.com/aashir-athar/mindeesai/blob/main/scripts/data/mix-broadbrain.json) (v4.1 — *Quality-pruned, gating-safe*). **22 datasets, ~42M tokens total**, every entry verified to load without authentication.

### Signal Share by Category

| Category | Share | Sources |
|---|---|---|
| **Broad assistant chat** | ~27% | OpenHermes-2.5, smoltalk, WizardLM evol-instruct |
| **Code** | ~28% | Magicoder Evol-Instruct, CodeFeedback Filtered, OpenCoder-SFT-stage2, CodeAlpaca, CodeParrot-clean |
| **Anchor (human-curated)** | ~19% | Dolly-15k, no_robots, smol-smoltalk |
| **Math + reasoning** | ~19% | MetaMathQA, MathInstruct, Open-Platypus, UltraInteract-SFT, OpenThoughts2-1M |
| **Knowledge / warmup** | ~4% | FineWeb-Edu, TinyStories |
| **Persona protection** | ~6% | SystemChat-1.1 (counter-acts robotic register) |
| **Domain spice** | ~1% | andstor/smart_contracts (Solidity / Web3) |
| **Empathy** | ~0.7% | Empathetic-Counseling, Mental-Health-Counseling (low weight to avoid clinical drift) |

### Tier-Weighted Highlights

| Weight | Dataset | Why |
|---|---|---|
| 2.5 | `databricks/databricks-dolly-15k` | Zero-synthetic human anchor |
| 2.5 | `HuggingFaceH4/no_robots` | Highest instruction quality per token in the mix |
| 2.0 | `HuggingFaceTB/smol-smoltalk` | HF's instruction dataset specifically tuned for sub-1B models |
| 1.8 | `abacusai/SystemChat-1.1` | Diverse system prompts — defends persona stability |
| 1.8 | `ise-uiuc/Magicoder-Evol-Instruct-110K` | Highest-quality code SFT on HF |
| 1.5 | `teknium/OpenHermes-2.5` | Broad-coverage instruction examples |
| 1.5 | `meta-math/MetaMathQA` | 395K math problems with worked CoT |
| 1.5 | `TIGER-Lab/MathInstruct` | Hybrid CoT + program-of-thought math |

### Datasets Staged for Future Stages

Three preference datasets (`HumanLLMs/Human-Like-DPO-Dataset`, `HuggingFaceH4/ultrafeedback_binarized`, `openbmb/UltraFeedback`) and one agentic-tool-use dataset (`nvidia/Nemotron-RL-Agentic-SWE-Pivot-v1`) are documented at [`scripts/data/mix-dpo-human.json`](https://github.com/aashir-athar/mindeesai/blob/main/scripts/data/mix-dpo-human.json) and [`scripts/data/mix-agentic-code.json`](https://github.com/aashir-athar/mindeesai/blob/main/scripts/data/mix-agentic-code.json). They are reserved for a planned DPO / RLHF / agentic-training stage and are **not** part of the current SFT pretraining.

---

## Training Procedure

### Hyperparameters (Active Configuration)

| Hyperparameter | Value | Notes |
|---|---|---|
| Optimizer | AdamW | β₁=0.9, β₂=0.95, ε=1e-8 |
| Weight decay | 0.1 | Applied to non-norm parameters |
| Learning rate | 3e-4 (peak) | Cosine schedule, 100-step linear warmup |
| Effective batch | 8 tokens (`home-11gb`) / 4 tokens (`cpu_max_5h_50k`) | After grad-accumulation |
| Sequence length | 2048 (`home-*`) / 256 (`cpu_max_5h_50k`) | Per Config |
| Gradient clipping | 1.0 | L2 norm |
| Completion-only loss | `--completion-only-loss 1` | Loss only on assistant turns (dialogue samples) |
| Persona loss weight | 0.05 | Soft signal — keeps Mindees voice without overfitting |
| Distill corpus weight | 4.0 | Real chat turns weighted 4× over base SFT mix |
| Base corpus weight | 1.0 | Seed conversations |
| Checkpoint every | 250 steps (GH Actions) / 1000 (Kaggle/Colab) | Resume-safe granularity |
| Validation every | 750 (GH Actions) / 500 (Kaggle/Colab) | Reports `val_loss` to `data/training-metrics.jsonl` |

### Federated Training Topology

Training is distributed across four independent compute pools, each pushing to its own HF branch. Every run **resumes from the prior session's checkpoint** so steps accumulate indefinitely:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Local RTX 5070       →  main           (owner-driven, sacrosanct)   │
│  GitHub Actions cron  →  small-weekly   (4× daily, CPU, 17.5M)       │
│  Kaggle Notebooks     →  kaggle-weekly  (weekly, T4 GPU, 280M)       │
│  Google Colab         →  colab-burst    (burst, T4 GPU, 280M)        │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                  ┌────────────────────────────────┐
                  │  HuggingFace Hub (this repo)   │
                  │  4 independent revisions       │
                  └────────────────────────────────┘
                                  │
                                  ▼
                  ┌────────────────────────────────┐
                  │  Cloudflare Workers deploy     │
                  │  + HF Spaces ML/vector sidecar │
                  │  Cost: $0/month forever        │
                  └────────────────────────────────┘
```

Reproducible training entry points live at [`scripts/train/`](https://github.com/aashir-athar/mindeesai/tree/main/scripts/train) and the four notebooks at [`scripts/notebooks/`](https://github.com/aashir-athar/mindeesai/tree/main/scripts/notebooks).

---

## The Mindees Persona

Unlike most foundation models, MindeesAI ships with **a deliberately scoped first-person identity** named **Mindees**. The persona is not a system-prompt overlay — it is woven into training via a dedicated `--corpus` and `--distill-corpus` weighting and reinforced by [`abacusai/SystemChat-1.1`](https://huggingface.co/datasets/abacusai/SystemChat-1.1), which teaches the model to **honor diverse system prompts without slipping into the robotic "as an AI" default register**.

A live **8-dimensional mood tensor** evolves each turn:

| Dimension | Range | Role |
|---|---|---|
| Curiosity | 0–1 | Pulls toward asking clarifying / exploratory questions |
| Warmth | 0–1 | Softens phrasing, mirrors user affect |
| Playfulness | 0–1 | Allows tasteful humor, wordplay |
| Focus | 0–1 | Trims preamble, prioritizes precision |
| Wonder | 0–1 | Encourages metaphor, broader framing |
| Frustration | 0–1 | Triggers de-escalation routines when high |
| Calm | 0–1 | Steadies tone on tense turns |
| Confidence | 0–1 | Modulates hedging language |

Mood is exposed at [`/api/mood`](https://mindeesai.0032ksa.workers.dev/api/mood) on the live deployment. It is fed into every generation step as part of the persona signal and persisted in [Cloudflare R2](https://developers.cloudflare.com/r2/) between turns.

---

## Self-Improvement Loop

A 30-minute cron triggers `/api/cron/self-improve` on the live deployment, which runs the following pipeline:

1. **Reflect** — read the most recent chat turns from R2.
2. **Extract** — distill new instruction / response pairs into `data/distill-corpus.jsonl`.
3. **Filter** — score each pair via the [`HumanLLMs/Human-Like-DPO-Dataset`](https://huggingface.co/datasets/HumanLLMs/Human-Like-DPO-Dataset)-style heuristic, drop low-quality.
4. **PII-scrub** — every appended line passes through [`Xenova/piiranha-v1-detect-personal-information`](https://huggingface.co/Xenova/piiranha-v1-detect-personal-information) + a regex backstop before persisting (emails, phones, credit cards, SSNs, addresses, IBANs, license numbers).
5. **Persist** — write the cleaned distill corpus + thumbs-up/down feedback to R2.
6. **Train (on next cron tick)** — the daily GitHub Actions workflow fetches the latest distill corpus from R2 and prepends it to the SFT mix, weighted 4× over base data.

**The model literally learns from its own conversations**, with privacy protection baked into the persistence layer. Public-revision checkpoints (`small-weekly`, `kaggle-weekly`) only ever contain weights trained on **PII-scrubbed** conversation data.

---

## Deployment & Infrastructure

MindeesAI is deployed end-to-end on **$0/month free-tier infrastructure** — no Vercel Pro, no Cloudflare Paid, no GPU rentals.

| Layer | Provider | Free quota | Role |
|---|---|---|---|
| Web app | **Cloudflare Workers Free** | 100k requests/day | SSR, chat streaming, API routes |
| ML + vector sidecar | **Hugging Face Spaces (Docker)** | 16 GB RAM, 50 GB disk | LanceDB vector store + 7 ML pipelines (PII, NER, sentiment, toxicity, reranker, zero-shot, summarizer) |
| Object storage | **Cloudflare R2** | 10 GB, 1M Class-A ops/mo | Persistent chat memory, distill corpus, mood state |
| Model checkpoints | **Hugging Face Hub** (this repo) | Unlimited public | Federated revisions, version history |
| Continual training | **GitHub Actions** | Unlimited for public repos | 4× daily SFT cron on `small-weekly` |
| Burst GPU training | **Kaggle Notebooks** | 30 GPU-hours/week | Heavy `home-11gb` training on `kaggle-weekly` |
| Backup GPU training | **Google Colab Free** | T4, idle-disconnect | Spillover heavy training on `colab-burst` |

Architecture detail at [`docs/CLOUDFLARE_HF_DEPLOY.md`](https://github.com/aashir-athar/mindeesai/blob/main/docs/CLOUDFLARE_HF_DEPLOY.md). The native binaries (LanceDB, ONNX, transformers.js) that Cloudflare Workers cannot load are isolated into the sidecar at [aashir-athar/mindeesai-sidecar](https://huggingface.co/spaces/aashir-athar/mindeesai-sidecar) and called over HTTPS + Bearer.

---

## Intended Use

| Use case | Suitability | Notes |
|---|---|---|
| Educational / research use | **Yes** | Primary intended use. Architecture, training code, recipes all open. |
| Personal assistant prototype | **Yes** | The live demo runs a working version. |
| Studying small-model behavior | **Yes** | Comparable to SmolLM / TinyLlama for under-1B research. |
| Production user-facing applications | **No, at this size** | Use a larger model (Llama-3.3-70B, Claude, etc.) via the LLM router. Mindees Native is reserved for cases where 280M is genuinely sufficient. |
| Safety-critical decision making | **No** | This is a research-stage model with limited evaluation. |
| Medical, legal, or financial advice | **No** | Empathy-counseling data is included at low weight to soften tone, not to qualify the model as a domain expert. |

---

## Limitations & Known Issues

- **Capacity ceiling.** At 17.5M (`cpu_max_5h_50k`) and 280M (`home-11gb`) parameters, the model fundamentally lacks the representation capacity of frontier models. Expect factual recall errors, math arithmetic mistakes, hallucinated code APIs.
- **English-dominant.** ~99% of the training mix is English. Performance on other languages is incidental.
- **In-progress training.** The `small-weekly` revision has plateaued at validation loss ≈ 3.5 (perplexity ≈ 34) — saturated for its capacity. The `home-11gb` runs on `kaggle-weekly` are still in early steps (~10k of an effective 200k+ schedule); expect meaningful quality only after further cumulative training.
- **Completion-only loss interaction with raw data.** Steps composed entirely of raw-kind samples (FineWeb-Edu, TinyStories, CodeParrot, Solidity) currently compute zero loss because `--completion-only-loss 1` masks tokens outside an assistant turn. A planned fix will apply standard CLM loss to raw samples.
- **No formal evaluation yet.** Standard benchmark numbers (MMLU, HellaSwag, GSM8K, HumanEval) have not been published for this checkpoint. Trust the loss curves only as relative-progress indicators.
- **Bias inherited from training data.** Synthetic data sources (OpenHermes, Magicoder, etc.) carry the biases of their teacher models. The persona system can soften the *register* of this bias but does not eliminate the *content*.

---

## License

This **model** is released under the **Apache License 2.0**. You are free to use, modify, distribute, and build commercial products on it.

### Training Data Provenance Notice

The model weights were trained on a mix of publicly available datasets, **each carrying its own license**. The model itself does not redistribute any training data, but downstream users intending **commercial** use should review the licenses of the individual datasets enumerated in the YAML metadata above. In particular:

- `databricks/databricks-dolly-15k` — CC-BY-SA 3.0 (commercial OK with attribution + share-alike)
- `HuggingFaceH4/no_robots` — CC-BY-NC 4.0 (**non-commercial**)
- `sahil2801/CodeAlpaca-20k` — CC-BY-NC 4.0 (**non-commercial**)
- `teknium/OpenHermes-2.5`, `HuggingFaceTB/smol-smoltalk`, `HuggingFaceTB/smoltalk` — typically Apache 2.0 / MIT (verify on dataset page)
- All other datasets — see their individual repository pages on Hugging Face

If your downstream use is non-commercial (research, education, personal projects), all included data is usable.

---

## Citation

If you use MindeesAI in research or downstream work, please cite the repository:

```bibtex
@misc{mindeesai2026,
  author       = {Aashir Athar},
  title        = {MindeesAI: A Self-Improving Open Native Transformer with a Persona},
  year         = {2026},
  publisher    = {Hugging Face},
  howpublished = {\url{https://huggingface.co/aashir-athar/mindeesai-base}},
  note         = {Trained from scratch on free-tier compute. Apache-2.0.},
}
```

---

## Acknowledgements

MindeesAI builds on the open work of many upstream projects. Sincere thanks to:

- The **DeepSeek-AI team** for the V3 / R1 architectural innovations (MLA, MTP, MoE patterns).
- **Andrej Karpathy** for `nanoGPT`, the model that proved you can teach a transformer from scratch in a few hundred lines.
- **Xenova** and the **transformers.js** project for browser/edge-runnable ONNX-quantized models.
- The **Hugging Face team** for `huggingface_hub`, Spaces, Datasets, and the Hub itself — the entire deployment stack depends on it.
- **bigcode** / **CodeParrot** / **OpenCoder** for the open code corpora.
- **databricks**, **teknium**, **abacusai**, **HuggingFaceTB**, **m-a-p**, **TIGER-Lab**, **meta-math**, **openbmb**, **garage-bAInd**, **ise-uiuc**, **LuangMV97**, **Amod**, **roneneldan**, **HuggingFaceFW**, **WizardLMTeam**, **andstor**, **open-thoughts** for the training datasets.
- **LanceDB** for the embedded vector store.
- **Cloudflare** and **Hugging Face** for the free-tier compute that makes the whole architecture economically real.

---

## Contact

- **Author:** Aashir Athar
- **GitHub:** [@aashir-athar](https://github.com/aashir-athar)
- **Repository:** [github.com/aashir-athar/mindeesai](https://github.com/aashir-athar/mindeesai)
- **Live demo:** [mindeesai.0032ksa.workers.dev](https://mindeesai.0032ksa.workers.dev)
- **Issues:** [GitHub Issues](https://github.com/aashir-athar/mindeesai/issues)

<div align="center">

— *Mindees is a small brain learning out loud.* —

</div>
