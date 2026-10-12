import { elapsedMs } from '../http.js';
import type { LlmUsage } from '../llm/client.js';
import type { Chunk } from '../llm/types.js';
import type { QueryInput, QueryTag, QueryTags } from '../query/translate-query.js';
import type { RerankResult, RerankStats } from '../rerank/types.js';
import type { Candidate } from '../search/candidate-search.js';
import { assertTemplate, type Template } from '../tagging/vocabulary.js';
import {
  generateDraft,
  type DraftRequest,
  type GenerationDependencies,
  type GenerationResult,
} from './generate.js';

/**
 * The template id selects both the tag presets and the prompt template. The instruction may be
 * empty when a template is chosen: translation then gives the presets alone, and the other steps
 * use the template's default instruction.
 */
export type QueryRequest = Omit<DraftRequest, 'chunks'>;

/**
 * What the search, rerank and generator are asked when the lawyer wrote no free text: the contract
 * itself, without generic words such as "upprätta" that would match unrelated chunks in full-text
 * search.
 */
export const DEFAULT_INSTRUCTIONS: Record<Template, string> = {
  employment: 'Anställningsavtal',
  nda: 'Sekretessavtal',
};

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
  /** Candidates the full-text fallback added. */
  fallback: number;
  /** The template's default instruction, when the free text was empty and it was used instead. */
  defaultInstruction?: string;
  /** The chunks handed to the generator, best first: what the reranker kept, or every candidate. */
  approved: Chunk[];
  /** Absent without a rerank step; `approved` is at most `RERANK_TOP_K` of the `relevant` chunks. */
  judging?: Pick<RerankStats, 'cacheHits' | 'unknown' | 'relevant'> & { judgeCalls: number };
  /** Absent when nothing was approved, or no draft was asked for. */
  draft?: GenerationResult;
  timings: StepTimings;
  usage: { translation?: LlmUsage; judging?: LlmUsage; generation?: LlmUsage };
}

/** One finished step, reported as soon as it is done (E7-1 streams them to the UI). */
export type QueryStep =
  | { step: 'translation'; tags: QueryTag[]; elapsedMs: number }
  | {
      step: 'search';
      candidates: number;
      fallback: number;
      embeddingMs?: number;
      searchMs: number;
    }
  | { step: 'rerank'; approved: number; relevant: number; elapsedMs: number }
  | { step: 'generation'; elapsedMs: number };

export type QueryStepName = QueryStep['step'];

/**
 * The steps `runQuery` will run with these dependencies, in order. Generation is planned when a
 * draft is asked for, but is skipped when nothing is approved.
 */
export function plannedSteps(
  deps: Pick<QueryFlowDependencies, 'translate' | 'rerank'>,
  { draft = true }: Pick<QueryOptions, 'draft'> = {},
): QueryStepName[] {
  return [
    ...(deps.translate ? (['translation'] as const) : []),
    'search',
    ...(deps.rerank ? (['rerank'] as const) : []),
    ...(draft ? (['generation'] as const) : []),
  ];
}

export interface QueryOptions {
  /** Whether to write the draft (default true); the benchmark can measure retrieval alone. */
  draft?: boolean;
  onStep?(step: QueryStep): void;
  /** Stops the flow before its next step, e.g. when the client went away. */
  signal?: AbortSignal;
}

/**
 * Query translation → candidate search → rerank → draft, with the time and tokens of each step.
 * Translation and rerank run only when the flow has them.
 */
export async function runQuery(
  request: QueryRequest,
  deps: QueryFlowDependencies,
  { draft: drafting = true, onStep, signal }: QueryOptions = {},
): Promise<QueryResult> {
  const started = performance.now();
  const { instruction, template } = request;
  const defaultInstruction =
    instruction.trim() === '' ? DEFAULT_INSTRUCTIONS[assertTemplate(template)] : undefined;
  const question = defaultInstruction ?? instruction;

  const translation = await deps.translate?.({ instruction, template });
  if (translation) {
    onStep?.({ step: 'translation', tags: translation.tags, elapsedMs: translation.elapsedMs });
  }
  const tags = translation?.tags.map((tag) => tag.slug) ?? [];
  signal?.throwIfAborted();

  const searchStarted = performance.now();
  const { candidates, embedMs } = await deps.search(question, tags);
  const chunks = deps.loadChunks(candidates.map((candidate) => String(candidate.chunkId)));
  const searchMs = elapsedMs(searchStarted);
  const fallback = candidates.filter(({ origin }) => origin === 'fts').length;
  onStep?.({
    step: 'search',
    candidates: candidates.length,
    fallback,
    embeddingMs: embedMs,
    searchMs,
  });
  signal?.throwIfAborted();

  const reranked = await deps.rerank?.(question, chunks);
  const approved = reranked ? reranked.ranked.map(({ chunk }) => chunk) : chunks;
  if (reranked) {
    onStep?.({
      step: 'rerank',
      approved: approved.length,
      relevant: reranked.stats.relevant,
      elapsedMs: reranked.stats.elapsedMs,
    });
  }

  signal?.throwIfAborted();
  const draft =
    drafting && approved.length > 0
      ? await generateDraft({ ...request, instruction: question, chunks: approved }, deps)
      : undefined;
  if (draft) onStep?.({ step: 'generation', elapsedMs: draft.elapsedMs });
  return {
    flow: deps.flow ?? 'main',
    tags,
    candidates: candidates.length,
    fallback,
    ...(defaultInstruction !== undefined && { defaultInstruction }),
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
