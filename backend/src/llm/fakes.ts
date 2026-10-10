// Deterministic fakes for tests and for running without an API key (`LLM_PROVIDER=fake`).
// Each fake takes an optional function that replaces its default answer.

import type { LlmClient, LlmRequest, LlmResponse } from './client.js';
import type {
  Chunk,
  Draft,
  GenerateInput,
  Generator,
  Judge,
  Judgement,
  QueryTranslator,
  Tag,
  Tagger,
} from './types.js';

const MIN_KEYWORD_LENGTH = 4;
const RELEVANCE_THRESHOLD = 0.5;

/** Low-level fake: answers with `answer(request)` and records every request. */
export interface FakeLlmClient extends LlmClient {
  readonly requests: LlmRequest[];
}

export function createFakeLlmClient(answer: (request: LlmRequest) => unknown): FakeLlmClient {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(request): Promise<LlmResponse> {
      requests.push(request);
      return { data: answer(request), usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

/** Default: the vocabulary tags whose name appears in the text (case-insensitive). */
export function createFakeTagger(
  answer: (chunkText: string, vocabulary: readonly Tag[]) => string[] = tagsMentionedIn,
): Tagger {
  return { tag: async (chunkText, vocabulary) => answer(chunkText, vocabulary) };
}

/** Default: the vocabulary tags whose name appears in the instruction (case-insensitive). */
export function createFakeQueryTranslator(
  answer: (instruction: string, vocabulary: readonly Tag[]) => string[] = tagsMentionedIn,
): QueryTranslator {
  return { translate: async (instruction, vocabulary) => answer(instruction, vocabulary) };
}

/** Default: score is the share of the instruction's keywords found in the chunk. */
export function createFakeJudge(
  answer: (instruction: string, chunk: Chunk) => Judgement = keywordOverlap,
): Judge {
  return { judge: async (instruction, chunk) => answer(instruction, chunk) };
}

/** Default: a draft listing the template, the instruction and every chunk, citing all chunks. */
export function createFakeGenerator(
  answer: (input: GenerateInput) => Draft = echoDraft,
): Generator {
  return { generate: async (input) => answer(input) };
}

function tagsMentionedIn(text: string, vocabulary: readonly Tag[]): string[] {
  const lower = text.toLowerCase();
  return vocabulary.filter((tag) => lower.includes(tag.name.toLowerCase())).map((tag) => tag.name);
}

function keywordOverlap(instruction: string, chunk: Chunk): Judgement {
  const keywords = instruction
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_KEYWORD_LENGTH);
  const text = chunk.text.toLowerCase();
  const score =
    keywords.length === 0
      ? 0
      : keywords.filter((word) => text.includes(word)).length / keywords.length;
  return { relevant: score >= RELEVANCE_THRESHOLD, score };
}

function echoDraft({ template, instruction, chunks }: GenerateInput): Draft {
  const sources = chunks.map((chunk) => `[${chunk.id}] ${chunk.text}`).join('\n');
  return {
    text: `${template}\n\n${instruction}\n\n${sources}`,
    references: chunks.map((chunk) => chunk.id),
  };
}
