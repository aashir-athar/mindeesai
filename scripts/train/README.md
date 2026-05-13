# `scripts/train/` — Pretraining + Bootstrap

The TypeScript runtime under `core/mindees-mind/` runs **online learning** — small gradient steps every 5 minutes on fresh conversation data. That's enough to make the model *measurably better* week-over-week once you have a usable base.

What this directory does is **mint that base**.

```
scripts/train/
├── tokenizer_train.py    Train BPE on a corpus → tokenizer/tokenizer.json
├── pretrain.py           Pretrain transformer weights on a corpus → checkpoints/base.bin
├── distill.py            Optional: distill from any teacher LLM (one-time bootstrap)
└── eval.py               Evaluate a checkpoint on a held-out set
```

You run these **once**, on a machine with a GPU (or once-with-patience on CPU). After that the in-process TypeScript training loop takes over and never needs Python again.

---

## Quick start

```bash
# Inside scripts/train/
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt

# 1. Train the tokenizer (≈ minutes on a single CPU)
python tokenizer_train.py --corpus ../data/corpus.txt --vocab-size 32000 --out ../../tokenizer/tokenizer.json

# 2. Pretrain the base weights (hours on a 24GB GPU; days on CPU)
python pretrain.py \
  --variant small \
  --corpus ../data/corpus.txt \
  --steps 50000 \
  --batch 8 \
  --lr 3e-4 \
  --out ../../checkpoints/base.bin

# 3. (Optional) Bootstrap-distill from a teacher LLM
python distill.py \
  --teacher anthropic \
  --teacher-model claude-opus-4-7 \
  --prompts ../data/distill-prompts.txt \
  --out ../../checkpoints/distilled-delta.bin
```

The output checkpoints land in `checkpoints/` and are picked up automatically the next time the TS runtime calls `getMind()`.

---

## `requirements.txt`

```
torch>=2.5
sentencepiece>=0.2
numpy>=1.26
tqdm>=4.66
datasets>=2.20
anthropic>=0.40         # only for distill.py
openai>=1.40            # only for distill.py
```

---

## Corpus

You need ~100MB+ of clean text to get a usable `small` checkpoint. Recommendations:

- **TinyStories** (Hugging Face) — small, clean, fast convergence; perfect for first runs
- **OpenAssistant Conversations** (oasst1) — conversational alignment data, free
- **WikiText-103** — encyclopedic text, free
- **The Stack** (small subset) — code, free for non-commercial bootstrap

Concatenate them into `scripts/data/corpus.txt` (one document per line, blank lines between).

---

## Why we publish the script but ship a small default

If we shipped a pretrained checkpoint in this repo, the repo would be a couple of GB on git clone — friction-deadly for contributors. Instead the README explains how to mint your own (or how to download a community-trained checkpoint from a release artifact once available).
