/**
 * BGE-small-en-v1.5 embedder (384-dim, Q8 quantized).
 * Lazy-loaded on first call, cached for process lifetime.
 */

let extractorPromise: Promise<(text: string) => Promise<number[]>> | null = null;

export async function getEmbedder(): Promise<(text: string) => Promise<number[]>> {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    console.log("[embeddings] loading BGE-small-en-v1.5 (q8)…");
    const t0 = performance.now();
    const { pipeline } = await import("@huggingface/transformers");
    const extractor = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", {
      dtype: "q8",
    });
    console.log(`[embeddings] loaded in ${(performance.now() - t0).toFixed(0)}ms`);
    return async (text: string): Promise<number[]> => {
      const out = (await extractor(text, { pooling: "mean", normalize: true })) as unknown as {
        data: Float32Array;
      };
      return Array.from(out.data);
    };
  })();
  return extractorPromise;
}

export async function embed(text: string): Promise<number[]> {
  const ext = await getEmbedder();
  return ext(text);
}
