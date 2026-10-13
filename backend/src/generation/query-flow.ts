import { elapsedMs } from '../http.js';
import type { LlmUsage } from '../llm/client.js';
import type { Chunk } from '../llm/types.js';
import type { QueryInput, QueryTag, QueryTags } from '../query/translate-query.js';
import type { RerankResult, RerankStats } from '../rerank/types.js';
import type { Candidate } from '../search/candidate-search.js';
import { assertTemplate, type Template } from '../tagging/vocabulary.js';
import type { FlowConfiguration } from './flow-configuration.js';
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
  /** What the steps are, for the timing panel and the run log (E7-3). */
  configuration?: FlowConfiguration;
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

/**
 * What became of a candidate: cited by the draft (by `[K:]` or a matched free-text reference), sent
 * to the generator but not cited, approved but
 * left out (by the context limits, or because no draft was written), or turned down by the reranker.
 */
export type SourceStatus = 'cited' | 'sent' | 'left-out' | 'turned-down';

/** A candidate the flow loaded, for the source list (E7-2). */
export interface QuerySource {
  chunk: Chunk;
  status: SourceStatus;
  /** Where the candidate came from, e.g. `tag` or `fts`. */
  origin: Candidate['origin'];
  /** The reranker's score and name; absent without a rerank step or when it could not score it. */
  score?: number;
  reranker?: string;
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
  /** Every candidate, in the retriever's order; those not approved were turned down. */
  sources: QuerySource[];
  /** Absent without a rerank step; `approved` is at most `RERANK_TOP_K` of the `relevant` chunks. */
  judging?: Pick<RerankStats, 'cacheHits' | 'unknown' | 'relevant'> & { judgeCalls: number };
  /** Absent when nothing was approved, or no draft was asked for. */
  draft?: GenerationResult;
  timings: StepTimings;
  usage: { translation?: LlmUsage; judging?: LlmUsage; generation?: LlmUsage };
}

/**
 * One finished step, reported as soon as it is done (E7-1 streams them to the UI), with its part of
 * the result's `timings`.
 */
export type QueryStep = (
  | { step: 'translation'; tags: QueryTag[] }
  | { step: 'search'; candidates: number; fallback: number }
  | { step: 'rerank'; approved: number; relevant: number }
  | { step: 'generation' }
) & { timings: Partial<StepTimings> };

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
  /** Filled with each step's time as it finishes, so a caller has them also when the flow fails. */
  reached?: Partial<StepTimings>;
}

/**
 * Query translation → candidate search → rerank → draft, with the time and tokens of each step.
 * Translation and rerank run only when the flow has them.
 */
export async function runQuery(
  request: QueryRequest,
  deps: QueryFlowDependencies,
  { draft: drafting = true, onStep, signal, reached = {} }: QueryOptions = {},
): Promise<QueryResult> {
  const started = performance.now();
  const { instruction, template } = request;
  const defaultInstruction =
    instruction.trim() === '' ? DEFAULT_INSTRUCTIONS[assertTemplate(template)] : undefined;
  const question = defaultInstruction ?? instruction;
  // Each step's time, collected as the steps report, so the result has the same times they sent.
  const report = (step: QueryStep) => {
    Object.assign(reached, step.timings);
    onStep?.(step);
  };

  const translation = await deps.translate?.({ instruction, template });
  if (translation) {
    report({
      step: 'translation',
      tags: translation.tags,
      timings: { translationMs: translation.elapsedMs },
    });
  }
  const tags = translation?.tags.map((tag) => tag.slug) ?? [];
  signal?.throwIfAborted();

  const searchStarted = performance.now();
  const { candidates, embedMs } = await deps.search(question, tags);
  const chunks = deps.loadChunks(candidates.map((candidate) => String(candidate.chunkId)));
  const searchMs = elapsedMs(searchStarted);
  const fallback = candidates.filter(({ origin }) => origin === 'fts').length;
  report({
    step: 'search',
    candidates: candidates.length,
    fallback,
    timings: { searchMs, ...(embedMs !== undefined && { embeddingMs: embedMs }) },
  });
  signal?.throwIfAborted();

  const reranked = await deps.rerank?.(question, chunks);
  const approved = reranked ? reranked.ranked.map(({ chunk }) => chunk) : chunks;
  if (reranked) {
    report({
      step: 'rerank',
      approved: approved.length,
      relevant: reranked.stats.relevant,
      timings: { judgingMs: reranked.stats.elapsedMs },
    });
  }

  signal?.throwIfAborted();
  const draft =
    drafting && approved.length > 0
      ? await generateDraft({ ...request, instruction: question, chunks: approved }, deps)
      : undefined;
  if (draft) report({ step: 'generation', timings: { generationMs: draft.elapsedMs } });
  const sources = describeSources(candidates, chunks, reranked, statuses(approved, draft));
  return {
    flow: deps.flow ?? 'main',
    tags,
    candidates: candidates.length,
    fallback,
    ...(defaultInstruction !== undefined && { defaultInstruction }),
    approved,
    sources,
    ...(reranked && {
      judging: {
        relevant: reranked.stats.relevant,
        cacheHits: reranked.stats.cacheHits,
        judgeCalls: reranked.stats.calls,
        unknown: reranked.stats.unknown,
      },
    }),
    draft,
    timings: { ...reached, searchMs, totalMs: elapsedMs(started) },
    usage: {
      translation: translation?.usage,
      judging: reranked?.stats.usage,
      generation: draft?.usage,
    },
  };
}

/** Each approved chunk's status; a chunk without one was turned down. */
function statuses(
  approved: readonly Chunk[],
  draft: GenerationResult | undefined,
): Map<string, SourceStatus> {
  const status = new Map<string, SourceStatus>(approved.map(({ id }) => [id, 'left-out']));
  for (const { id } of draft?.unused ?? []) status.set(id, 'sent');
  // A chunk the draft refers to only in free text ("7 § LAS") is cited as much as one it cites [K:].
  for (const { id } of draft?.used ?? []) status.set(id, 'cited');
  for (const { chunkId } of draft?.check?.matches ?? []) status.set(chunkId, 'cited');
  return status;
}

/** Each loaded candidate with its origin, its status and, when the reranker scored it, its score. */
function describeSources(
  candidates: readonly Candidate[],
  chunks: readonly Chunk[],
  reranked: RerankResult | undefined,
  status: ReadonlyMap<string, SourceStatus>,
): QuerySource[] {
  const loaded = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const scores = new Map(reranked?.scored.map((scored) => [scored.chunk.id, scored]));
  return candidates.flatMap(({ chunkId, origin }): QuerySource[] => {
    const chunk = loaded.get(String(chunkId));
    if (!chunk) return [];
    const scored = scores.get(chunk.id);
    return [
      {
        chunk,
        status: status.get(chunk.id) ?? 'turned-down',
        origin,
        ...(scored && { score: scored.score, reranker: scored.reranker }),
      },
    ];
  });
}
