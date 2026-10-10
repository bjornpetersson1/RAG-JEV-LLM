// LLM-backed role implementations. The tagger prompt is real (E3-2); the other prompts are
// placeholders that only make the wiring work, replaced in E4-4 (query translator), E5-1 (judge)
// and E6 (generator).

import { LlmError, sumUsage, type JsonSchema, type LlmClient, type LlmUsage } from './client.js';
import type {
  Chunk,
  Generator,
  Judge,
  QueryTranslator,
  Tag,
  Tagger,
  TaggingInput,
  TaggingResult,
} from './types.js';

/** How many tags the tagger asks for per chunk. */
export const TAGS_PER_CHUNK = { min: 3, max: 8 } as const;

// A list of slugs is short; the margin covers a model that explains itself despite the schema.
const TAGGER_MAX_TOKENS = 2000;

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

/**
 * Asks for 3–8 tags per chunk with the whole vocabulary in a cached system prompt. Unknown slugs
 * are discarded; when fewer than the minimum remain, one more call says which slugs were invalid.
 */
export function createLlmTagger(client: LlmClient): Tagger {
  // A run passes the same vocabulary for every chunk; build its prompt and slug set once.
  const prepared = new WeakMap<readonly Tag[], { system: string; known: ReadonlySet<string> }>();
  const prepare = (vocabulary: readonly Tag[]) => {
    let entry = prepared.get(vocabulary);
    if (!entry) {
      entry = { system: taggerSystemPrompt(vocabulary), known: slugSet(vocabulary) };
      prepared.set(vocabulary, entry);
    }
    return entry;
  };

  return {
    async tag(chunk, vocabulary) {
      const { system, known } = prepare(vocabulary);
      const usages: LlmUsage[] = [];
      const ask = async (prompt: string) => {
        const { data, usage } = await client.complete({
          system,
          prompt,
          schema: TAGS_SCHEMA,
          maxTokens: TAGGER_MAX_TOKENS,
          cacheSystem: true,
        });
        usages.push(usage);
        return sortTags(readStringArray(data, 'tags'), known);
      };

      try {
        const first = await ask(taggerPrompt(chunk));
        if (first.tags.length >= TAGS_PER_CHUNK.min) {
          return { ...first, retried: false, usage: sumUsage(usages) };
        }
        const second = await ask(taggerRetryPrompt(chunk, first));
        // The retry's answer leads; the first answer's tags fill up when it still has too few.
        const tags =
          second.tags.length >= TAGS_PER_CHUNK.min
            ? second.tags
            : [...new Set([...second.tags, ...first.tags])];
        return {
          tags,
          discarded: [...new Set([...first.discarded, ...second.discarded])],
          overLimit: second.overLimit,
          retried: true,
          usage: sumUsage(usages),
        };
      } catch (error) {
        // Calls that succeeded before the failure were billed too; carry their tokens with it.
        if (error instanceof LlmError && error.usage) usages.push(error.usage);
        throw new LlmError(error instanceof Error ? error.message : String(error), {
          retryable: false,
          usage: sumUsage(usages),
        });
      }
    },
  };
}

function taggerSystemPrompt(vocabulary: readonly Tag[]): string {
  const areas = new Map<string, Tag[]>();
  for (const tag of vocabulary) {
    const tags = areas.get(tag.area) ?? [];
    tags.push(tag);
    areas.set(tag.area, tags);
  }
  const sections = [...areas].map(([area, tags]) =>
    [`## ${area}`, ...tags.map((tag) => `- ${tag.slug}: ${tag.label} – ${tag.description}`)].join(
      '\n',
    ),
  );
  return [
    'Du taggar avsnitt ur svenska lagar och domar om anställning, avtal och sekretess, så att de ' +
      'kan hittas när en jurist skriver ett anställningsavtal eller ett sekretessavtal.',
    `Välj ${TAGS_PER_CHUNK.min}–${TAGS_PER_CHUNK.max} taggar ur vokabulären nedan som beskriver ` +
      'vad avsnittet handlar om. Regler:',
    '- Använd bara slugs exakt som de står i vokabulären.',
    '- Välj det som avsnittet faktiskt reglerar eller prövar, inte ämnen som bara nämns i förbigående.',
    '- Föredra specifika taggar framför allmänna när båda passar.',
    '- Lista de viktigaste taggarna först.',
    '',
    'Vokabulär, grupperad per område (slug: etikett – beskrivning):',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

function taggerPrompt(chunk: TaggingInput): string {
  return [
    chunk.source && `Källa: ${chunk.source}`,
    chunk.context && `Sammanhang: ${chunk.context}`,
    `Text:\n${chunk.text}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function taggerRetryPrompt(
  chunk: TaggingInput,
  previous: Pick<TaggingResult, 'tags' | 'discarded'>,
): string {
  const problem =
    previous.discarded.length > 0
      ? `Dessa slugs finns inte i vokabulären: ${previous.discarded.join(', ')}.`
      : 'Det var för få taggar.';
  return [
    taggerPrompt(chunk),
    '',
    `Ditt förra svar gav ${previous.tags.length} giltiga taggar. ${problem}`,
    `Välj ${TAGS_PER_CHUNK.min}–${TAGS_PER_CHUNK.max} slugs som finns i vokabulären.`,
  ].join('\n');
}

/** Splits the answers into kept tags (unique, in order, at most the maximum) and the rest. */
function sortTags(
  slugs: string[],
  known: ReadonlySet<string>,
): Pick<TaggingResult, 'tags' | 'discarded' | 'overLimit'> {
  const { valid, invalid } = splitSlugs(slugs, known);
  return {
    tags: valid.slice(0, TAGS_PER_CHUNK.max),
    discarded: invalid,
    overLimit: valid.slice(TAGS_PER_CHUNK.max),
  };
}

export function createLlmQueryTranslator(client: LlmClient): QueryTranslator {
  return {
    async translate(instruction, vocabulary) {
      const { data } = await client.complete({
        system: 'Pick the tags from the vocabulary that a search for the instruction should use.',
        prompt: `Vocabulary:\n${formatVocabulary(vocabulary)}\n\nInstruction:\n${instruction}`,
        schema: TAGS_SCHEMA,
      });
      return keepVocabularyTags(readStringArray(data, 'tags'), vocabulary);
    },
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

function formatVocabulary(vocabulary: readonly Tag[]): string {
  return vocabulary.map((tag) => `- ${tag.slug}: ${tag.description}`).join('\n');
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
  return splitSlugs(tags, slugSet(vocabulary)).valid;
}

function slugSet(vocabulary: readonly Tag[]): ReadonlySet<string> {
  return new Set(vocabulary.map((tag) => tag.slug));
}

/**
 * The slugs that are and are not in `known`, each once, in their first order. Case and surrounding
 * whitespace are ignored, since vocabulary slugs are lower case and never padded.
 */
function splitSlugs(slugs: string[], known: ReadonlySet<string>) {
  const unique = [...new Set(slugs.map((slug) => slug.trim().toLowerCase()))];
  return {
    valid: unique.filter((slug) => known.has(slug)),
    invalid: unique.filter((slug) => !known.has(slug)),
  };
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
