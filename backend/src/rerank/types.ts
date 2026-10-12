import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../env.js';
import type { LlmLogger, LlmUsage } from '../llm/client.js';
import type { LlmConfig } from '../llm/config.js';
import type { ModelDtype } from '../models/config.js';
import type { Chunk, JudgeScore } from '../llm/types.js';

/** A chunk with its relevance score; the same shape whichever reranker produced it. */
export interface ScoredChunk {
  chunk: Chunk;
  /** Relevance from 0 to 1, normalised by the reranker. */
  score: number;
  /** The `RERANKER` value that produced the score, e.g. `jev`. */
  reranker: string;
  /** The reranker's model, e.g. `jev-latest` or `claude-haiku-5-5`. */
  model: string;
  /** For the judge-based rerankers: JEV, or the LLM (also when it stood in for JEV). */
  answeredBy?: JudgeScore['judgedBy'];
}

/** What a rerank cost and how it went, for the query output and the evaluation. */
export interface RerankStats {
  /** Scoring calls made; cache hits make none. */
  calls: number;
  cacheHits: number;
  /** Chunks that could not be scored (failure or timeout); they count as not relevant. */
  unknown: number;
  /** Chunks that reached the threshold, before `topK` cut them to `ranked`. */
  relevant: number;
  usage: LlmUsage;
  elapsedMs: number;
}

export interface RerankResult {
  /** The relevant chunks, best first, at most `topK`. */
  ranked: ScoredChunk[];
  /** Every chunk that got a score, best first, before the threshold and `topK`. */
  scored: ScoredChunk[];
  stats: RerankStats;
}

/** Scores chunks against a query and keeps the best. */
export interface Reranker {
  /** The `RERANKER` value, e.g. `llm`. */
  readonly name: string;
  readonly model: string;
  /** The precision a local model runs in, e.g. `int8`; absent for a remote reranker. */
  readonly dtype?: ModelDtype;
  rerank(query: string, chunks: readonly Chunk[], topK: number): Promise<RerankResult>;
}

/** What every reranker may build on; the judge-based ones use all of it. */
export interface RerankerDependencies {
  /** The judge cache lives here. */
  db: DatabaseSync;
  /** The LLM judge's provider and model. */
  llmConfig: LlmConfig;
  logger: LlmLogger;
  fetch?: typeof fetch;
}

/** One `RERANKER` value: adding a reranker is a new file with one of these plus a registry entry. */
export interface RerankerEntry {
  /** Reads the reranker's own settings from `env` and throws on an invalid or missing one. */
  validate(env: Env): void;
  create(env: Env, deps: RerankerDependencies): Reranker;
}
