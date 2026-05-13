#!/usr/bin/env python3
"""
Optional bootstrap distillation from a teacher LLM.

Run **once** during cold start to seed the MindeesAI weights with high-quality
behavior. After this finishes, the teacher key can be revoked — the model is
self-sufficient.

How:
  1. Read prompts from a file (one per line).
  2. For each prompt, call the teacher LLM and capture the answer.
  3. Append (prompt, answer) pairs as JSONL.
  4. Run `pretrain.py --corpus <this jsonl> --resume <existing base.bin>` to
     continue training from those pairs.

This script ONLY does step 1-3.

Usage:
  python distill.py --teacher anthropic --teacher-model claude-opus-4-7 \
                    --prompts ../data/distill-prompts.txt \
                    --out ../data/distilled.jsonl
"""

import argparse
import json
import os
import sys
from pathlib import Path


def call_anthropic(model: str, prompt: str) -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    rsp = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return rsp.content[0].text


def call_openai(model: str, prompt: str) -> str:
    import openai
    client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    rsp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    return rsp.choices[0].message.content


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--teacher", choices=["anthropic", "openai"], required=True)
    ap.add_argument("--teacher-model", required=True)
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    callers = {"anthropic": call_anthropic, "openai": call_openai}
    caller = callers[args.teacher]

    prompts = [p.strip() for p in Path(args.prompts).read_text(encoding="utf-8").splitlines() if p.strip()]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        for i, prompt in enumerate(prompts):
            try:
                answer = caller(args.teacher_model, prompt)
            except Exception as e:
                print(f"[{i}] failed: {e}", file=sys.stderr)
                continue
            f.write(json.dumps({"prompt": prompt, "answer": answer}) + "\n")
            f.flush()
            if (i + 1) % 25 == 0:
                print(f"  {i + 1}/{len(prompts)}")

    print(f"wrote {args.out}  pairs={len(prompts)}")


if __name__ == "__main__":
    main()
