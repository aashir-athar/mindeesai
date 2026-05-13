/**
 * Pure-JS CPU backend.
 *
 * For the v0.1 ship, every op already lives in `model/ops.ts` and is JS-only.
 * This file is the explicit "yes, this is the active backend" entry point so
 * that swapping to WebGPU/WASM in the future is one import change away.
 */

export { matmul, matmulBackward, rmsNorm, rmsNormBackward, silu, mul, softmax, crossEntropy, transpose } from "../model/ops";
