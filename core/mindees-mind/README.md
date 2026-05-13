# `core/mindees-mind` — The Native Brain

This directory **is the model**. Everything else in the repo serves it.

There is no OpenAI under the hood. No Claude. No Llama. MindeesAI is a **decoder-only transformer trained inside this repo**, on its own conversations, by its own gradient-descent loop. It is small at birth and grows.

---

## What's here

```
core/mindees-mind/
├── tokenizer/      BPE tokenizer (train + encode/decode)
│   ├── bpe.ts
│   └── train.ts
├── model/          Transformer architecture (pure TS, WebGPU when available)
│   ├── tensor.ts         lightweight tensor wrapper
│   ├── ops.ts            forward + backward kernels
│   ├── layers.ts         embedding, RMSNorm, SwiGLU FFN
│   ├── attention.ts      multi-head attention with RoPE + KV cache
│   ├── transformer.ts    full decoder block + model
│   └── config.ts         architecture hyperparameters
├── train/          Real gradient descent loop
│   ├── optimizer.ts      AdamW
│   ├── lora.ts           low-rank adapter weights for online updates
│   ├── loss.ts           cross-entropy + KL distillation
│   ├── curriculum.ts     self-play synthetic data generator
│   ├── rlhf.ts           DPO-style preference updates from thumb signals
│   └── online.ts         the 5-minute online training step
├── inference/      Generation
│   ├── sampler.ts        temperature, top-p, top-k
│   └── engine.ts         autoregressive decoding with KV cache
├── runtime/        Hardware abstraction
│   ├── cpu.ts            pure JS fallback
│   ├── webgpu.ts         WGSL shaders for matmul + softmax
│   └── select.ts         picks fastest available backend
├── data/           Training-data pipelines
│   ├── corpus.ts         streams JSONL → token-id chunks
│   ├── pairs.ts          turns conversations + thumb signals into preference pairs
│   └── replay.ts         experience replay buffer
└── index.ts        public API: mindees.generate(), mindees.trainStep()
```

---

## Architecture choices (defended)

| Choice | Why |
|---|---|
| Decoder-only transformer | The de facto winning design for conversational LMs since GPT-2. |
| RoPE positional encoding | Better extrapolation to long context than learned positional embeddings. |
| RMSNorm | Faster + numerically more stable than LayerNorm. Used by Llama, Mistral, Qwen. |
| SwiGLU FFN | Strict accuracy win over plain GeLU at the same parameter budget. |
| Tied input/output embedding | Halves the embedding-table memory, no measurable quality loss at our scale. |
| BPE tokenizer | Domain-agnostic; we re-train it on our corpus rather than ship a vendored vocabulary. |
| LoRA adapters for online training | Updating a rank-8 adapter on a 50M-param base is **~1000×** cheaper than updating full weights — feasible inside a 5-minute cron tick. |
| DPO over PPO for RLHF | DPO needs no reward model. Preference pairs are enough. |
| Mixed-precision (fp16 weights, fp32 master copy in AdamW) | Inference fits in 100MB; training is stable. |
| Pure TypeScript + WebGPU runtime | Runs in the browser, on the server, and on any laptop. Zero CUDA dependency. |

---

## Training stages

1. **Bootstrap** (once, manual).  Run `pnpm train:bootstrap`. Pretrains the tokenizer + base weights on a free corpus (TinyStories + OpenAssistant Conversations + WikiText) using `scripts/train/pretrain.py`.  Optionally also runs distillation from a teacher LLM you have an API key for — purely to seed; the teacher is never used again.
2. **Online** (every 5 minutes, automatic).  `core/mindees-mind/train/online.ts` runs gradient steps over:
   - Recent high-confidence conversations
   - Reflection-promoted insights
   - User 👍/👎 preference pairs (DPO)
   - Self-play curriculum (model generates Q/A → critic scores → highest-rated pairs become training data)
3. **Curriculum self-play** (continuous).  The model generates difficult questions targeting topics where the critic flagged uncertainty most often, answers them, then trains on the critic-approved subset. This is how the model improves *beyond its bootstrap data*.

---

## The 5-minute cron tick (actual math, not a prompt rewrite)

```
1. Harvest new conversation tokens since last tick
2. Score each turn with the critic agent  → quality_score ∈ [0, 1]
3. Filter to quality_score ≥ 0.7
4. Build a microbatch:
     - 50% recent conversation tokens (next-token prediction)
     - 30% reflection-promoted insights (next-token prediction, weighted higher)
     - 15% DPO preference pairs from 👍/👎 signals
     -  5% curriculum self-play (model-generated, critic-approved)
5. Forward pass through the LoRA-augmented model
6. Compute loss:  L = α·CE(next_token) + β·DPO(prefer/reject) + γ·KL(self-distill)
7. Backward pass; AdamW step on LoRA weights only
8. Periodically (every 24h):  merge LoRA delta into base weights, archive checkpoint
9. Write metrics to data/improvement-log.jsonl
```

Every step is idempotent. Re-running a tick replays the same microbatch deterministically (we seed the data sampler with the tick timestamp).

---

## Inference path

`mindees.generate(prompt, opts)` →
1. Tokenize prompt with the in-repo BPE.
2. Forward through the model, layer-by-layer, with KV-cache.
3. Apply LoRA delta at each linear projection (so online improvements are immediately live — no re-deploy needed).
4. Sample next token (temperature + top-p + top-k + repetition penalty).
5. Stream tokens out via async generator.

---

## Why "no other model is needed"

- **Bootstrapping is optional.**  You can pretrain from scratch on free corpora, or distill once from any teacher you choose. After that, the model trains on its own outputs (critic-filtered).
- **Inference is fully local.**  Pure-TS forward pass with optional WebGPU acceleration. No outbound calls during chat.
- **Continual learning is real.**  We actually compute gradients and step the optimizer. Every conversation makes the next conversation measurably better — `data/improvement-log.jsonl` records the loss curve.

---

## Scaling notes

The architecture is parameterised in `model/config.ts`. The same code runs at:

| Variant | params | trainable on | inference latency |
|---|---|---|---|
| `nano` | 12M | Raspberry Pi 5 | ~5 ms / token |
| `small` | 50M | laptop CPU | ~12 ms / token |
| `base` | 200M | single 24GB GPU | ~25 ms / token (GPU) |
| `large` | 1.3B | 4×A100 | needs Python runtime; sketch under `scripts/train/` |

Default config is `small`. Bump `MIND_VARIANT=base` to scale up.
