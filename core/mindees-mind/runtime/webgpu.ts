/**
 * WebGPU kernels — accelerated matmul + softmax.
 *
 * Not yet wired into `model/ops.ts`. Lands as a follow-up PR. Scaffolding is
 * here so contributors can pick it up.
 *
 * Sketch:
 *   - Allocate a single `GPUBuffer` per Tensor on first GPU op
 *   - WGSL kernel for tiled matmul (16×16 workgroup, fp16 accumulators)
 *   - WGSL kernel for fused RMSNorm + linear
 *   - Sync back to Float32Array only when the host reads the tensor
 *
 * The WGSL source string below is a known-good 16×16-tile matmul. It is dead
 * code until `runtime/select.ts` returns "webgpu" AND the model/ops imports
 * are rerouted through here.
 */

export const MATMUL_WGSL = /* wgsl */ `
struct Dim { M: u32, N: u32, K: u32 };
@group(0) @binding(0) var<storage, read>       A : array<f32>;
@group(0) @binding(1) var<storage, read>       B : array<f32>;
@group(0) @binding(2) var<storage, read_write> C : array<f32>;
@group(0) @binding(3) var<uniform> dim : Dim;

var<workgroup> aTile : array<array<f32, 16>, 16>;
var<workgroup> bTile : array<array<f32, 16>, 16>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_id)  lid: vec3<u32>) {
  let row = gid.y;
  let col = gid.x;
  var acc : f32 = 0.0;
  let tiles = (dim.K + 15u) / 16u;

  for (var t : u32 = 0u; t < tiles; t = t + 1u) {
    let aCol = t * 16u + lid.x;
    let bRow = t * 16u + lid.y;
    aTile[lid.y][lid.x] = select(0.0, A[row * dim.K + aCol], aCol < dim.K && row < dim.M);
    bTile[lid.y][lid.x] = select(0.0, B[bRow * dim.N + col], bRow < dim.K && col < dim.N);
    workgroupBarrier();

    for (var k : u32 = 0u; k < 16u; k = k + 1u) {
      acc = acc + aTile[lid.y][k] * bTile[k][lid.x];
    }
    workgroupBarrier();
  }
  if (row < dim.M && col < dim.N) {
    C[row * dim.N + col] = acc;
  }
}
`;
