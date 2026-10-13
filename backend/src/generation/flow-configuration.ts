// What a flow runs with (E7-3), for the timing panel, the run log and the benchmark's table: each
// step's implementation as a short label, e.g. `minilm cross-encoder/mmarco-mMiniLMv2-L12-H384-v1 int8`.

export interface FlowConfiguration {
  /** E.g. `tags`, `both`, or `dense Xenova/bge-m3 int8` for the reference RAG. */
  retriever: string;
  /** Absent without a rerank step. */
  reranker?: string;
  /** Absent when the query is not translated. */
  translator?: string;
  generator: string;
  /** `roaring` or `bloom`; absent when tag search is not used. */
  tagIndex?: string;
  /** How many chunks go on to the generator at most. */
  topK: number;
}

/** The configuration as one line, e.g. for a table cell. */
export function formatConfiguration(configuration: FlowConfiguration): string {
  const { retriever, reranker, translator, generator, tagIndex, topK } = configuration;
  return [
    `retriever ${retriever}`,
    ...(tagIndex ? [`tag index ${tagIndex}`] : []),
    ...(translator ? [`translator ${translator}`] : []),
    ...(reranker ? [`reranker ${reranker}`] : []),
    `top ${topK}`,
    `generator ${generator}`,
  ].join(' · ');
}

/** A local or remote model as `<model> <precision>`, the precision left out when there is none. */
export function modelLabel({ model, dtype }: { model: string; dtype?: string }): string {
  return dtype ? `${model} ${dtype}` : model;
}
