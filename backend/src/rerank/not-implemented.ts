import type { RerankerEntry } from './types.js';

/** A registered reranker that passes startup and throws when asked to rerank. */
export function notImplementedReranker(name: string, model: string, plan: string): RerankerEntry {
  return {
    // The placeholders are local models still to be built (e.g. qwen3).
    remote: false,
    validate() {},
    create() {
      return {
        name,
        model,
        rerank() {
          return Promise.reject(
            new Error(`RERANKER=${name} is not implemented yet (${plan}); use bge, llm or jev`),
          );
        },
      };
    },
  };
}
