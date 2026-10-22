// What a flow runs with (E7-3), for the timing panel, the run log and the benchmark's table: each
// step's implementation as a short label, e.g. `llm claude-haiku-5-5`.

export interface FlowConfiguration {
  /** E.g. `tags`, or `bm25` for the reference RAG. */
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

/** A reranker as `<RERANKER value> <model>`, e.g. `llm claude-haiku-5-5`. */
export function rerankerLabel({ name, model }: { name: string; model: string }): string {
  return `${name} ${model}`;
}
