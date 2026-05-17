/**
 * Centralised transformers.js pipeline cache for the sidecar.
 * Mirrors the model lineup in the main app's lib/ml/transformers-pool.ts.
 * Every pipeline is lazy, Q8, and returns null on load failure.
 */

type AnyPipeline = (...args: unknown[]) => Promise<unknown>;

interface ModelSpec {
  task: string;
  model: string;
  dtype?: "q4" | "q8" | "fp16" | "fp32";
}

const cache = new Map<string, Promise<AnyPipeline | null>>();

async function getPipeline(spec: ModelSpec): Promise<AnyPipeline | null> {
  const key = `${spec.task}::${spec.model}::${spec.dtype ?? "q8"}`;
  if (cache.has(key)) return cache.get(key)!;
  const p = (async (): Promise<AnyPipeline | null> => {
    try {
      const { pipeline } = await import("@huggingface/transformers");
      console.log(`[pool] loading ${spec.task} ${spec.model} (${spec.dtype ?? "q8"})…`);
      const t0 = performance.now();
      const pl = (await pipeline(spec.task as never, spec.model, {
        dtype: spec.dtype ?? "q8",
      })) as unknown as AnyPipeline;
      console.log(`[pool]  loaded ${spec.model} in ${(performance.now() - t0).toFixed(0)}ms`);
      return pl;
    } catch (e) {
      console.warn(`[pool] could not load ${spec.model}:`, e);
      return null;
    }
  })();
  cache.set(key, p);
  return p;
}

const MODELS = {
  reranker:   { task: "text-classification",   model: "Xenova/ms-marco-MiniLM-L-12-v2",                   dtype: "q8" as const },
  sentiment:  { task: "text-classification",   model: "Xenova/twitter-roberta-base-sentiment-latest",     dtype: "q8" as const },
  ner:        { task: "token-classification",  model: "Xenova/bert-base-NER",                             dtype: "q8" as const },
  toxicity:   { task: "text-classification",   model: "Xenova/toxic-bert",                                dtype: "q8" as const },
  pii:        { task: "token-classification",  model: "Xenova/piiranha-v1-detect-personal-information",   dtype: "q8" as const },
  zeroShot:   { task: "zero-shot-classification", model: "Xenova/nli-deberta-v3-xsmall",                  dtype: "q8" as const },
  summarizer: { task: "summarization",         model: "Xenova/distilbart-cnn-6-6",                        dtype: "q8" as const },
} satisfies Record<string, ModelSpec>;

export const rerankerPipeline = () => getPipeline(MODELS.reranker);
export const sentimentPipeline = () => getPipeline(MODELS.sentiment);
export const nerPipeline = () => getPipeline(MODELS.ner);
export const toxicityPipeline = () => getPipeline(MODELS.toxicity);
export const piiPipeline = () => getPipeline(MODELS.pii);
export const zeroShotPipeline = () => getPipeline(MODELS.zeroShot);
export const summarizerPipeline = () => getPipeline(MODELS.summarizer);
