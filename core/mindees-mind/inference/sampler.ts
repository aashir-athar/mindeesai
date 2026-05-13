/**
 * Token samplers — temperature, top-k, top-p, repetition penalty.
 *
 * Operates on the final-position logits row (Float32Array of length vocab).
 * Returns a single chosen token ID.
 */

export interface SamplerOptions {
  temperature?: number;        // 0 = greedy, 1 = canonical, >1 = creative
  topK?: number;               // 0 = disabled
  topP?: number;               // 0 = disabled
  repetitionPenalty?: number;  // 1.0 = disabled
  previousTokens?: Int32Array; // for repetition penalty
}

export function sample(logits: Float32Array, opts: SamplerOptions = {}): number {
  const { temperature = 0.8, topK = 40, topP = 0.95, repetitionPenalty = 1.1, previousTokens } = opts;

  const scaled = new Float32Array(logits.length);
  for (let i = 0; i < logits.length; i++) scaled[i] = (logits[i] ?? 0) / Math.max(temperature, 1e-6);

  // Repetition penalty
  if (repetitionPenalty !== 1.0 && previousTokens) {
    const seen = new Set<number>(previousTokens);
    for (const t of seen) {
      const v = scaled[t]!;
      scaled[t] = v > 0 ? v / repetitionPenalty : v * repetitionPenalty;
    }
  }

  // Greedy fast path
  if (temperature <= 1e-4) {
    let best = 0;
    let bestV = -Infinity;
    for (let i = 0; i < scaled.length; i++) {
      if (scaled[i]! > bestV) { bestV = scaled[i]!; best = i; }
    }
    return best;
  }

  // Build (token, prob) candidate list
  const indices: number[] = Array.from({ length: scaled.length }, (_, i) => i);
  indices.sort((a, b) => scaled[b]! - scaled[a]!);

  let keep = indices.length;
  if (topK > 0 && topK < keep) keep = topK;
  const top = indices.slice(0, keep);

  // Softmax over the top set
  let maxV = -Infinity;
  for (const i of top) if (scaled[i]! > maxV) maxV = scaled[i]!;
  let sum = 0;
  const probs = new Float64Array(top.length);
  for (let j = 0; j < top.length; j++) {
    probs[j] = Math.exp(scaled[top[j]!]! - maxV);
    sum += probs[j]!;
  }
  for (let j = 0; j < top.length; j++) probs[j] = (probs[j] ?? 0) / sum;

  // Top-P (nucleus): truncate after cumulative prob exceeds threshold
  if (topP > 0 && topP < 1) {
    let cum = 0;
    let cutoff = top.length;
    for (let j = 0; j < top.length; j++) {
      cum += probs[j] ?? 0;
      if (cum >= topP) { cutoff = j + 1; break; }
    }
    if (cutoff < top.length) {
      // Renormalise
      let s = 0;
      for (let j = 0; j < cutoff; j++) s += probs[j] ?? 0;
      for (let j = 0; j < cutoff; j++) probs[j] = (probs[j] ?? 0) / s;
      top.length = cutoff;
    }
  }

  // Sample
  const r = Math.random();
  let acc = 0;
  for (let j = 0; j < top.length; j++) {
    acc += probs[j] ?? 0;
    if (r <= acc) return top[j]!;
  }
  return top[top.length - 1]!;
}
