import { elapsedMs } from '../http.js';
import type { JudgeAllResult } from '../judge/judge-all.js';
import type { LlmUsage } from '../llm/client.js';
import type { Chunk } from '../llm/types.js';
import type { QueryInput, QueryTags } from '../query/translate-query.js';
import type { CandidateSearchResult } from '../search/candidate-search.js';
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
  translate(query: QueryInput): Promise<QueryTags>;
  search(instruction: string, tags: readonly string[]): CandidateSearchResult;
  loadChunks(ids: readonly string[]): Chunk[];
  judge(instruction: string, chunks: readonly Chunk[]): Promise<JudgeAllResult>;
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
  judging: Pick<JudgeAllResult, 'cacheHits' | 'judgeCalls' | 'unknown'> & { approved: number };
  /** Absent when the judge approved no chunk: no draft is written without sources. */
  draft?: GenerationResult;
  timings: StepTimings;
  usage: { translation?: LlmUsage; judging: LlmUsage; generation?: LlmUsage };
}

/** Query translation → candidate search → judging → draft, with the time and tokens of each step. */
export async function runQuery(
  request: QueryRequest,
  deps: QueryFlowDependencies,
): Promise<QueryResult> {
  const started = performance.now();
  const { instruction, template } = request;

  const translation = await deps.translate({ instruction, template });
  const tags = translation.tags.map((tag) => tag.slug);

  const searchStarted = performance.now();
  const { candidates } = deps.search(instruction, tags);
  const chunks = deps.loadChunks(candidates.map((candidate) => String(candidate.chunkId)));
  const searchMs = elapsedMs(searchStarted);

  const judged = await deps.judge(instruction, chunks);
  const approved = rankByScore(judged);

  const draft =
    approved.length > 0 ? await generateDraft({ ...request, chunks: approved }, deps) : undefined;
  return {
    tags,
    candidates: candidates.length,
    judging: {
      approved: approved.length,
      cacheHits: judged.cacheHits,
      judgeCalls: judged.judgeCalls,
      unknown: judged.unknown,
    },
    draft,
    timings: {
      translationMs: translation.elapsedMs,
      searchMs,
      judgingMs: judged.elapsedMs,
      generationMs: draft?.elapsedMs,
      totalMs: elapsedMs(started),
    },
    usage: { translation: translation.usage, judging: judged.usage, generation: draft?.usage },
  };
}

/** The relevant chunks by descending judge score; ties keep the candidate order. */
export function rankByScore({ relevant, judgements }: JudgeAllResult): Chunk[] {
  const scores = new Map(
    judgements.flatMap((judgement) =>
      judgement.status === 'unknown' ? [] : [[judgement.chunkId, judgement.score] as const],
    ),
  );
  // Array.prototype.sort is stable, so equal scores stay in candidate order.
  return [...relevant].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
}
