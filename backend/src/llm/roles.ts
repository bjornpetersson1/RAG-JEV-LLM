// LLM-backed role implementations. The prompts are placeholders that only make the wiring work;
// the real prompts come in E3-2 (tagger), E4-4 (query translator), E5-1 (judge) and E6 (generator).

import { LlmError, type JsonSchema, type LlmClient } from './client.js';
import type { Chunk, Generator, Judge, QueryTranslator, Tag, Tagger } from './types.js';

const TAGS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { tags: { type: 'array', items: { type: 'string' } } },
  required: ['tags'],
  additionalProperties: false,
};

const JUDGEMENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { relevant: { type: 'boolean' }, score: { type: 'number' } },
  required: ['relevant', 'score'],
  additionalProperties: false,
};

const DRAFT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    references: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'references'],
  additionalProperties: false,
};

export function createLlmTagger(client: LlmClient): Tagger {
  const pickTags = createTagPicker(
    client,
    'Pick the tags from the vocabulary that describe the text.',
  );
  return { tag: (chunkText, vocabulary) => pickTags(`Text:\n${chunkText}`, vocabulary) };
}

export function createLlmQueryTranslator(client: LlmClient): QueryTranslator {
  const pickTags = createTagPicker(
    client,
    'Pick the tags from the vocabulary that a search for the instruction should use.',
  );
  return {
    translate: (instruction, vocabulary) => pickTags(`Instruction:\n${instruction}`, vocabulary),
  };
}

export function createLlmJudge(client: LlmClient): Judge {
  return {
    async judge(instruction, chunk) {
      const { data } = await client.complete({
        system: 'Decide whether the text is relevant to the instruction. Give a score from 0 to 1.',
        prompt: `Instruction:\n${instruction}\n\nText:\n${chunk.text}`,
        schema: JUDGEMENT_SCHEMA,
      });
      const relevant = readField(data, 'relevant');
      const score = readField(data, 'score');
      if (typeof relevant !== 'boolean' || typeof score !== 'number' || Number.isNaN(score)) {
        throw invalidResponse('a boolean "relevant" and a numeric "score"');
      }
      return { relevant, score: Math.min(1, Math.max(0, score)) };
    },
  };
}

export function createLlmGenerator(client: LlmClient): Generator {
  return {
    async generate({ template, instruction, chunks }) {
      const { data } = await client.complete({
        system:
          'Draft the document from the template and instruction, using only the sources. ' +
          'List the ids of the sources you cite.',
        prompt: `Template:\n${template}\n\nInstruction:\n${instruction}\n\nSources:\n${formatChunks(chunks)}`,
        schema: DRAFT_SCHEMA,
      });
      const text = readField(data, 'text');
      if (typeof text !== 'string') throw invalidResponse('a string "text"');
      const chunkIds = new Set(chunks.map((chunk) => chunk.id));
      const references = [
        ...new Set(readStringArray(data, 'references').filter((id) => chunkIds.has(id))),
      ];
      return { text, references };
    },
  };
}

function createTagPicker(client: LlmClient, system: string) {
  return async (input: string, vocabulary: readonly Tag[]): Promise<string[]> => {
    const { data } = await client.complete({
      system,
      prompt: `Vocabulary:\n${formatVocabulary(vocabulary)}\n\n${input}`,
      schema: TAGS_SCHEMA,
    });
    return keepVocabularyTags(readStringArray(data, 'tags'), vocabulary);
  };
}

function formatVocabulary(vocabulary: readonly Tag[]): string {
  return vocabulary
    .map((tag) => (tag.description ? `- ${tag.name}: ${tag.description}` : `- ${tag.name}`))
    .join('\n');
}

function formatChunks(chunks: readonly Chunk[]): string {
  return chunks
    .map((chunk) => {
      const source = chunk.source ? ` (${chunk.source})` : '';
      return `[${chunk.id}]${source} ${chunk.text}`;
    })
    .join('\n\n');
}

function keepVocabularyTags(tags: string[], vocabulary: readonly Tag[]): string[] {
  const known = new Set(vocabulary.map((tag) => tag.name));
  return [...new Set(tags.filter((tag) => known.has(tag)))];
}

function readField(data: unknown, field: string): unknown {
  return typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)[field]
    : undefined;
}

function readStringArray(data: unknown, field: string): string[] {
  const value = readField(data, field);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw invalidResponse(`a string array "${field}"`);
  }
  return value;
}

function invalidResponse(expected: string): LlmError {
  return new LlmError(`LLM response does not match the schema: expected ${expected}`, {
    retryable: false,
  });
}
