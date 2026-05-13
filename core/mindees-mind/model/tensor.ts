/**
 * Tiny tensor abstraction.
 *
 * Why we don't pull in `tfjs` or `onnxruntime-web` at this layer:
 *  - We want full visibility into every kernel for training-loop debugging
 *  - We want to swap CPU ↔ WebGPU per-operation, not per-tensor
 *  - The model is small enough that a hand-rolled Float32Array tensor is fine
 *
 * The runtime picks the fastest available backend for each op (see runtime/select.ts).
 * Tensors stay as plain Float32Array views — backends operate on the raw buffer.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("tensor");

export type Shape = readonly number[];

export class Tensor {
  readonly data: Float32Array;
  readonly shape: Shape;
  readonly strides: number[];

  constructor(data: Float32Array, shape: Shape) {
    const size = shape.reduce((a, b) => a * b, 1);
    if (data.length !== size) {
      throw new Error(`tensor size mismatch: data.length=${data.length}, expected ${size} for shape ${shape}`);
    }
    this.data = data;
    this.shape = shape;
    this.strides = computeStrides(shape);
  }

  static zeros(shape: Shape): Tensor {
    return new Tensor(new Float32Array(shape.reduce((a, b) => a * b, 1)), shape);
  }

  static ones(shape: Shape): Tensor {
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size).fill(1);
    return new Tensor(data, shape);
  }

  /** Kaiming/He normal init — appropriate for SwiGLU / linear-layer pre-activations. */
  static kaiming(shape: Shape, fanIn: number): Tensor {
    const std = Math.sqrt(2 / fanIn);
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) data[i] = randn() * std;
    return new Tensor(data, shape);
  }

  /** Uniform init in [-bound, bound]. Used for embedding tables. */
  static uniform(shape: Shape, bound: number): Tensor {
    const size = shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(size);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * bound;
    return new Tensor(data, shape);
  }

  get size(): number {
    return this.data.length;
  }

  get rank(): number {
    return this.shape.length;
  }

  /** Reshape (no copy) — must preserve total element count. */
  reshape(shape: Shape): Tensor {
    if (shape.reduce((a, b) => a * b, 1) !== this.size) {
      throw new Error(`reshape size mismatch ${this.shape} → ${shape}`);
    }
    return new Tensor(this.data, shape);
  }

  /** Clone — full copy. */
  clone(): Tensor {
    return new Tensor(new Float32Array(this.data), this.shape);
  }

  /** Zero this tensor in-place. */
  zero(): void {
    this.data.fill(0);
  }

  /** Returns a flat copy as a plain JS number array — for serialisation only. */
  toArray(): number[] {
    return Array.from(this.data);
  }
}

function computeStrides(shape: Shape): number[] {
  const strides = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * shape[i + 1]!;
  }
  return strides;
}

/** Box-Muller standard-normal sample. */
function randn(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

log.debug("tensor module loaded");
