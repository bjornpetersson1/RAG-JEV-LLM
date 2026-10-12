import { elapsedMs } from '../http.js';
import type { LlmUsage } from '../llm/client.js';
import type { Chunk } from '../llm/types.js';
import type { QueryInput, QueryTags } from '../query/translate-query.js';
import type { RerankResult, RerankStats } from '../rerank/types.js';
import type { Candidate } from '../search/candidate-search.js';
import {
  generateDraft,
  type DraftRequest,
  type GenerationDependencies,
  type GenerationResult,
} from './generate.js';

/** The template id selects both the tag presets and the prompt template. */
export type QueryRequest = Omit<DraftRequest, 'chunks'>;

/** Which flow produced a result: the main flow, or the reference RAG (E5-4). */
export type QueryFlowName = 'main' | 'reference';

/**
 * The steps of a query flow, each built from `.env` (`generation/setup.ts`, `reference/setup.ts`)
 * or faked in tests. A step that is absent is skipped, and its fields are absent from the result.
 */
export interface QueryFlowDependencies extends GenerationDependencies {
  /** Default `main`. */
  flow?: QueryFlowName;
  /** Absent when the retriever uses no tags (`RETRIEVER=bge`, the reference RAG). */
  translate?(query: QueryInput): Promise<QueryTags>;
  /** The candidates, best first, and the time spent embedding the instruction, if it was. */
  search(
    instruction: string,
    tags: readonly string[],
  ): Promise<{ candidates: readonly Candidate[]; embedMs?: number }>;
  loadChunks(ids: readonly string[]): Chunk[];
  /**
   * The configured reranker with `RERANK_TOP_K`: the relevant chunks, best first. Absent for the
   * reference RAG, which hands every candidate to the generator.
   */
  rerank?(instruction: string, chunks: readonly Chunk[]): Promise<RerankResult>;
}

/** Each step's time in ms; a step that did not run is absent. */
export interface StepTimings {
  translationMs?: number;
  /** Embedding the instruction, part of `searchMs`. */
  embeddingMs?: number;
  /** Candidate search, embedding the instruction included, and loading the candidates' text. */
  searchMs: number;
  judgingMs?: number;
  /** Absent when nothing was approved, or no draft was asked for. */
  generationMs?: number;
  totalMs: number;
}

export interface QueryResult {
  flow: QueryFlowName;
  /** Empty when the query was not translated. */
  tags: string[];
  candidates: number;
  /** The chunks handed to the generator, best first: what the reranker kept, or every candidate. */
  approved: Chunk[];
  /** Absent without a rerank step; `approved` is at most `RERANK_TOP_K` of the `relevant` chunks. */
  judging?: Pick<RerankStats, 'cacheHits' | 'unknown' | 'relevant'> & { judgeCalls: number };
  /** Absent when nothing was approved, or no draft was asked for. */
  draft?: GenerationResult;
  timings: StepTimings;
  usage: { translation?: LlmUsage; judging?: LlmUsage; generation?: LlmUsage };
}

export interface QueryOptions {
  /** Whether to write the draft (default true); the benchmark can measure retrieval alone. */
  draft?: boolean;
}

/**
 * Query translation → candidate search → rerank → draft, with the time and tokens of each step.
 * Translation and rerank run only when the flow has them.
 */
export async function runQuery(
  request: QueryRequest,
  deps: QueryFlowDependencies,
  { draft: drafting = true }: QueryOptions = {},
): Promise<QueryResult> {
  const started = performance.now();
  const { instruction, template } = request;

  const translation = await deps.translate?.({ instruction, template });
  const tags = translation?.tags.map((tag) => tag.slug) ?? [];

  const searchStarted = performance.now();
  const { candidates, embedMs } = await deps.search(instruction, tags);
  const chunks = deps.loadChunks(candidates.map((candidate) => String(candidate.chunkId)));
  const searchMs = elapsedMs(searchStarted);

  const reranked = await deps.rerank?.(instruction, chunks);
  const approved = reranked ? reranked.ranked.map(({ chunk }) => chunk) : chunks;

  const draft =
    drafting && approved.length > 0
      ? await generateDraft({ ...request, chunks: approved }, deps)
      : undefined;
  return {
    flow: deps.flow ?? 'main',
    tags,
    candidates: candidates.length,
    approved,
    ...(reranked && {
      judging: {
        relevant: reranked.stats.relevant,
        cacheHits: reranked.stats.cacheHits,
        judgeCalls: reranked.stats.calls,
        unknown: reranked.stats.unknown,
      },
    }),
    draft,
    timings: {
      translationMs: translation?.elapsedMs,
      embeddingMs: embedMs,
      searchMs,
      judgingMs: reranked?.stats.elapsedMs,
      generationMs: draft?.elapsedMs,
      totalMs: elapsedMs(started),
    },
    usage: {
      translation: translation?.usage,
      judging: reranked?.stats.usage,
      generation: draft?.usage,
    },
  };
}
