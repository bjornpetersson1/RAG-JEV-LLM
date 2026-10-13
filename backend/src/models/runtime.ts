// The local model runtime (E8-2): ONNX models run in Node through transformers.js on
// onnxruntime-node, on the CPU. Models are downloaded from Hugging Face once into the model cache.
// transformers.js 3.x is used because its onnxruntime-node (1.21) still ships an Intel macOS
// binary, which the demo machine needs; 4.x's (1.30) has Apple Silicon only.
// The library is imported on first load, so code that never runs a model (the server, the tests)
// does not load onnxruntime.

import type { CrossEncoderModel } from './catalog.js';
import type { ModelDtype } from './config.js';

/** Raw [CLS] vectors, one per text, not normalised. */
export type EncodeTexts = (texts: readonly string[]) => Promise<Float32Array[]>;

/**
 * One raw relevance logit per (query, passage) pair, and whether the pair was cut to fit the
 * model's `maxTokens`.
 */
export type ScorePairs = (
  pairs: readonly { query: string; passage: string }[],
) => Promise<{ logit: number; truncated: boolean }[]>;

/** `load` runs on the first call and is reused; a failure is not kept, so the next call retries. */
export function lazyRetry<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () =>
    (loaded ??= load().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    }));
}

/** `work`, with calls run one at a time in call order, e.g. so CPU-bound jobs do not compete. */
export function oneAtATime<A extends unknown[], R>(
  work: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let previous: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const run = previous.then(() => work(...args));
    previous = run.catch(() => {});
    return run;
  };
}

/** `items` in consecutive slices of at most `size`. */
export function* inBatches<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) {
    yield items.slice(start, start + size);
  }
}

/** Loads a feature-extraction model, e.g. bge-m3, with [CLS] pooling. */
export async function loadTextEncoder(
  model: string,
  dtype: ModelDtype,
  cacheDir: string,
): Promise<EncodeTexts> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const extract = await pipeline('feature-extraction', model, { dtype, device: 'cpu' });
  return async (texts) => {
    const output = await extract([...texts], { pooling: 'cls', normalize: false });
    const [rows, width] = output.dims;
    const data = output.data as Float32Array;
    return Array.from({ length: rows }, (_, i) => data.slice(i * width, (i + 1) * width));
  };
}

/** Loads a cross-encoder, e.g. bge-reranker-v2-m3, from its ONNX file for `dtype`. */
export async function loadCrossEncoder(
  model: CrossEncoderModel,
  dtype: ModelDtype,
  cacheDir: string,
): Promise<ScorePairs> {
  const { env, AutoModelForSequenceClassification, AutoTokenizer } =
    await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const tokenizer = await AutoTokenizer.from_pretrained(model.id);
  const file = model.files?.[dtype];
  const classifier = await AutoModelForSequenceClassification.from_pretrained(model.id, {
    // A file of its own is named in full: `dtype` 'fp32' only stops transformers.js from adding a
    // precision suffix to the name, whatever the file's precision is.
    ...(file ? { model_file_name: file, dtype: 'fp32' } : { dtype }),
    device: 'cpu',
    use_external_data_format: dtype === 'fp32' && (model.fp32ExternalData ?? false),
  });
  const { maxTokens } = model;
  // The separators the model puts around a pair, e.g. `<s> … </s></s> … </s>` for XLM-RoBERTa.
  const pairSpecialTokens = tokenizer.encode('', { text_pair: '' }).length;

  /** At most half the pair, so a very long instruction still leaves room for the passage. */
  const maxQueryTokens = Math.floor((maxTokens - pairSpecialTokens) / 2);

  /** The query, cut to `maxQueryTokens` when longer, with its token count. */
  function fitQuery(query: string) {
    const ids = tokenizer.encode(query, { add_special_tokens: false });
    if (ids.length <= maxQueryTokens) return { query, tokens: ids.length, cut: false };
    const cut = tokenizer.decode(ids.slice(0, maxQueryTokens), { skip_special_tokens: true });
    return { query: cut, tokens: maxQueryTokens, cut: true };
  }

  /**
   * The pair with its passage cut so the pair fits `maxTokens`. The tokenizer's own truncation cuts
   * the pair's end, which drops the closing separator the model was trained with.
   */
  function fit(query: string, queryTokens: number, passage: string) {
    const passageIds = tokenizer.encode(passage, { add_special_tokens: false });
    const budget = maxTokens - queryTokens - pairSpecialTokens;
    if (passageIds.length <= budget) return { query, passage, truncated: false };
    const cut = tokenizer.decode(passageIds.slice(0, Math.max(budget, 0)), {
      skip_special_tokens: true,
    });
    return { query, passage: cut, truncated: true };
  }

  return async (pairs) => {
    // The pairs of one call usually share their query, so each query is fitted once.
    const queries = new Map<string, { query: string; tokens: number; cut: boolean }>();
    const fitted = pairs.map(({ query, passage }) => {
      if (!queries.has(query)) queries.set(query, fitQuery(query));
      const fittedQuery = queries.get(query)!;
      const pair = fit(fittedQuery.query, fittedQuery.tokens, passage);
      return { ...pair, truncated: pair.truncated || fittedQuery.cut };
    });
    const inputs = tokenizer(
      fitted.map(({ query }) => query),
      {
        text_pair: fitted.map(({ passage }) => passage),
        padding: true,
        // A safety net only: decoding and re-encoding the cut passage can differ by a token.
        truncation: true,
        max_length: maxTokens,
      },
    );
    const { logits } = await classifier(inputs);
    return Array.from(logits.data as Float32Array, (logit, i) => ({
      logit,
      truncated: fitted[i].truncated,
    }));
  };
}
