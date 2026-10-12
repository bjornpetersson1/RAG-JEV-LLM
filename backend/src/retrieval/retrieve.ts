// `npm run retrieve` (E8-4): the configured retriever and reranker for one question, without a
// draft, with the time of each step.

import { parseArgs } from 'node:util';
import { parsePositiveInteger } from '../env.js';
import { elapsedMs } from '../http.js';
import type { Chunk } from '../llm/types.js';
import type { Candidate } from '../search/candidate-search.js';
import type { Reranker, ScoredChunk } from '../rerank/types.js';
import type { Retriever } from './retriever.js';

export interface RetrieveDependencies {
  retriever: Retriever;
  /** The question's tags; called only when the retriever uses tags. */
  translate(question: string): Promise<string[]>;
  loadChunks(ids: readonly string[]): Chunk[];
  reranker: Reranker;
}

export interface RetrievedChunk extends ScoredChunk {
  /** 1-based place in the retriever's candidate list. */
  retrievalRank: number;
  origin: Candidate['origin'];
}

export interface RetrieveResult {
  retriever: string;
  reranker: string;
  candidates: number;
  chunks: RetrievedChunk[];
  timings: {
    translationMs: number;
    embedMs: number;
    retrievalMs: number;
    rerankMs: number;
    totalMs: number;
  };
}

/** Retrieves candidates for `question` and reranks them, keeping the best `topK`. */
export async function retrieve(
  question: string,
  topK: number,
  deps: RetrieveDependencies,
): Promise<RetrieveResult> {
  const started = performance.now();
  const { retriever, reranker } = deps;

  let tags: string[] = [];
  let translationMs = 0;
  if (retriever.usesTags) {
    tags = await deps.translate(question);
    translationMs = elapsedMs(started);
  }

  const { candidates, embedMs, searchMs } = await retriever.retrieve(question, tags);
  const ranks = new Map(
    candidates.map((candidate, i) => [String(candidate.chunkId), { rank: i + 1, candidate }]),
  );
  const chunks = deps.loadChunks([...ranks.keys()]);

  const { ranked, stats } = await reranker.rerank(question, chunks, topK);
  return {
    retriever: retriever.name,
    reranker: `${reranker.name} (${reranker.model})`,
    candidates: candidates.length,
    chunks: ranked.map((scored) => {
      const { rank, candidate } = ranks.get(scored.chunk.id)!;
      return { ...scored, retrievalRank: rank, origin: candidate.origin };
    }),
    timings: {
      translationMs,
      embedMs,
      retrievalMs: searchMs,
      rerankMs: stats.elapsedMs,
      totalMs: elapsedMs(started),
    },
  };
}

/** The result for the terminal: one line per kept chunk, then the time per step. */
export function formatRetrieveResult(result: RetrieveResult): string {
  const { timings } = result;
  return [
    `Retriever: ${result.retriever} (${result.candidates} candidates) · reranker: ${result.reranker}`,
    '',
    ...result.chunks.map(
      (chunk, i) =>
        `${String(i + 1).padStart(2)}. ${chunk.chunk.source ?? chunk.chunk.id}` +
        ` · rerank ${chunk.score.toFixed(3)} · retrieval rank ${chunk.retrievalRank} (${chunk.origin})`,
    ),
    '',
    `Time (ms): translation ${timings.translationMs} · embed query ${timings.embedMs} · ` +
      `retrieval ${timings.retrievalMs} · rerank ${timings.rerankMs} · total ${timings.totalMs}`,
  ].join('\n');
}

export const RETRIEVE_USAGE = 'Usage: retrieve "<question>" [--top-k <n>]';

/** `"<question>" [--top-k <n>]`, or undefined. */
export function parseRetrieveArgs(args: string[]): { question: string; topK?: number } | undefined {
  let parsed;
  try {
    parsed = parseArgs({ args, options: { 'top-k': { type: 'string' } }, allowPositionals: true });
  } catch {
    return undefined;
  }
  const { values, positionals } = parsed;
  const question = positionals.length === 1 ? positionals[0].trim() : '';
  if (question === '') return undefined;
  if (values['top-k'] === undefined) return { question };
  const topK = parsePositiveInteger(values['top-k']);
  return topK === undefined ? undefined : { question, topK };
}
