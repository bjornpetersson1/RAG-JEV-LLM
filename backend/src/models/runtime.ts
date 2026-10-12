// The local model runtime (E8-2): ONNX models run in Node through transformers.js on
// onnxruntime-node, on the CPU. Models are downloaded from Hugging Face once into the model cache.
// transformers.js 3.x is used because its onnxruntime-node (1.21) still ships an Intel macOS
// binary, which the demo machine needs; 4.x's (1.30) has Apple Silicon only.
// The library is imported on first load, so code that never runs a model (the server, the tests)
// does not load onnxruntime.

import type { ModelDtype } from './config.js';

/** Raw [CLS] vectors, one per text, not normalised. */
export type EncodeTexts = (texts: readonly string[]) => Promise<Float32Array[]>;

/** One raw relevance logit per (query, passage) pair. */
export type ScorePairs = (
  pairs: readonly { query: string; passage: string }[],
  maxTokens: number,
) => Promise<number[]>;

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

/** Loads a cross-encoder, e.g. bge-reranker-v2-m3. */
export async function loadCrossEncoder(
  model: string,
  dtype: ModelDtype,
  cacheDir: string,
): Promise<ScorePairs> {
  const { env, AutoModelForSequenceClassification, AutoTokenizer } =
    await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const tokenizer = await AutoTokenizer.from_pretrained(model);
  const classifier = await AutoModelForSequenceClassification.from_pretrained(model, {
    dtype,
    device: 'cpu',
    // The fp32 weights are in a separate `.onnx_data` file, which this model's config does not
    // declare, so transformers.js would not download it.
    use_external_data_format: dtype === 'fp32',
  });
  return async (pairs, maxTokens) => {
    const inputs = tokenizer(
      pairs.map(({ query }) => query),
      {
        text_pair: pairs.map(({ passage }) => passage),
        padding: true,
        truncation: true,
        max_length: maxTokens,
      },
    );
    const { logits } = await classifier(inputs);
    return Array.from(logits.data as Float32Array);
  };
}
