/**
 * dictionary — free dictionary API. No key.
 *
 * https://api.dictionaryapi.dev/api/v2/entries/en/<word>
 * Returns an array of entries with meanings + part-of-speech + examples.
 */

import type { ConnectorHandler } from "@/lib/connectors/types";

type Args = { word: string };

interface DefEntry {
  word: string;
  phonetic?: string;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition: string; example?: string }>;
    synonyms?: string[];
    antonyms?: string[];
  }>;
}

const handler: ConnectorHandler<Args> = async (args, ctx) => {
  const word = (args?.word ?? "").trim().toLowerCase();
  if (!word || !/^[a-z][a-z'-]{0,40}$/.test(word)) {
    return { ok: false, error: "word required (single English word, ≤ 40 chars)" };
  }
  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await ctx.fetch(url, { signal: ctx.signal });
    if (res.status === 404) return { ok: false, error: `no entry found for "${word}"` };
    if (!res.ok) return { ok: false, error: `dictionary ${res.status}`, retryable: true };
    const data = (await res.json()) as DefEntry[];
    const first = data?.[0];
    if (!first) return { ok: false, error: `no entry found for "${word}"` };
    return {
      ok: true,
      output: {
        word: first.word,
        phonetic: first.phonetic,
        meanings: (first.meanings ?? []).slice(0, 4).map((m) => ({
          part_of_speech: m.partOfSpeech,
          definitions: (m.definitions ?? []).slice(0, 3).map((d) => ({
            definition: d.definition,
            example: d.example,
          })),
          synonyms: (m.synonyms ?? []).slice(0, 6),
          antonyms: (m.antonyms ?? []).slice(0, 6),
        })),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
};

export default handler;
