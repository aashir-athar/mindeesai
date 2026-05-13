/**
 * Int8 quantization for the KV cache.
 *
 * At long context the KV cache dominates memory. Quantizing each token's K and
 * V vectors from fp32 (4 bytes/dim) to int8 (1 byte/dim + tiny scale metadata)
 * gives a 4× memory reduction with sub-1% accuracy loss.
 *
 * We use per-token symmetric quantization:
 *   scale = max(|x|) / 127
 *   x_q   = round(x / scale)
 *   x_dq  = x_q · scale
 *
 * The cache writes go through `quantize()`; reads go through `dequantize()`.
 * MLA's compressed cache + int8 quantization stack on top of each other —
 * `mlaLatentDim · 1 byte` is ~16× smaller than vanilla fp32 K+V.
 */

export interface QuantizedVector {
  q: Int8Array;
  scale: number;
}

export function quantize(x: Float32Array): QuantizedVector {
  let maxAbs = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs / 127 || 1e-8;
  const q = new Int8Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const v = x[i]! / scale;
    q[i] = Math.max(-127, Math.min(127, Math.round(v)));
  }
  return { q, scale };
}

export function dequantize(qv: QuantizedVector): Float32Array {
  const out = new Float32Array(qv.q.length);
  for (let i = 0; i < qv.q.length; i++) out[i] = qv.q[i]! * qv.scale;
  return out;
}

/**
 * Quantize a 2D matrix row-by-row. Returns one (q, scale) pair per row.
 * For the KV cache, "row" = one token's vector.
 */
export function quantizeRows(matrix: Float32Array, rows: number, cols: number): {
  data: Int8Array;
  scales: Float32Array;
} {
  const data = new Int8Array(rows * cols);
  const scales = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    const slice = matrix.subarray(r * cols, (r + 1) * cols);
    const qv = quantize(slice);
    scales[r] = qv.scale;
    data.set(qv.q, r * cols);
  }
  return { data, scales };
}

export function dequantizeRows(data: Int8Array, scales: Float32Array, rows: number, cols: number): Float32Array {
  const out = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const s = scales[r]!;
    for (let c = 0; c < cols; c++) out[r * cols + c] = data[r * cols + c]! * s;
  }
  return out;
}
