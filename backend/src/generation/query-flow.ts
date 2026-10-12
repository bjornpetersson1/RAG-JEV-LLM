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

/** The steps of the query flow, each built from `.env` in `setup.ts` or faked in tests. */
export interface QueryFlowDependencies extends GenerationDependencies {
  /** Absent when the retriever uses no tags (`RETRIEVER=bge`): the query is then not translated. */
  translate?(query: QueryInput): Promise<QueryTags>;
  /** The configured retriever's candidates, best first. */
  search(
    instruction: string,
    tags: readonly string[],
  ): Promise<{ candidates: readonly Candidate[] }>;
  loadChunks(ids: readonly string[]): Chunk[];
  /** The configured reranker with `RERANK_TOP_K`: the relevant chunks, best first. */
  rerank(instruction: string, chunks: readonly Chunk[]): Promise<RerankResult>;
}

export interface StepTimings {
  translationMs: number;
  /** Candidate search and loading the candidates' text. */
  searchMs: number;
  judgingMs: number;
  /** Absent when nothing was approved and no draft was generated. */
  generationMs?: number;
  totalMs: number;
}

export interface QueryResult {
  tags: string[];
  candidates: number;
  /** `approved` is what the reranker kept: at most `RERANK_TOP_K` of the `relevant` chunks. */
  judging: Pick<RerankStats, 'cacheHits' | 'unknown' | 'relevant'> & {
    approved: number;
    judgeCalls: number;
  };
  /** Absent when the judge approved no chunk: no draft is written without sources. */
  draft?: GenerationResult;
  timings: StepTimings;
  usage: { translation?: LlmUsage; judging: LlmUsage; generation?: LlmUsage };
}

/** Query translation → candidate search → rerank → draft, with the time and tokens of each step. */
export async function runQuery(
  request: QueryRequest,
  deps: QueryFlowDependencies,
): Promise<QueryResult> {
  const started = performance.now();
  const { instruction, template } = request;

  const translation = await deps.translate?.({ instruction, template });
  const tags = translation?.tags.map((tag) => tag.slug) ?? [];

  const searchStarted = performance.now();
  const { candidates } = await deps.search(instruction, tags);
  const chunks = deps.loadChunks(candidates.map((candidate) => String(candidate.chunkId)));
  const searchMs = elapsedMs(searchStarted);

  const { ranked, stats } = await deps.rerank(instruction, chunks);
  const approved = ranked.map(({ chunk }) => chunk);

  const draft =
    approved.length > 0 ? await generateDraft({ ...request, chunks: approved }, deps) : undefined;
  return {
    tags,
    candidates: candidates.length,
    judging: {
      approved: approved.length,
      relevant: stats.relevant,
      cacheHits: stats.cacheHits,
      judgeCalls: stats.calls,
      unknown: stats.unknown,
    },
    draft,
    timings: {
      translationMs: translation?.elapsedMs ?? 0,
      searchMs,
      judgingMs: stats.elapsedMs,
      generationMs: draft?.elapsedMs,
      totalMs: elapsedMs(started),
    },
    usage: { translation: translation?.usage, judging: stats.usage, generation: draft?.usage },
  };
}
