// LLM-backed role implementations: the tagger (E3-2), query translator (E4-4), judge (E5-1) and
// generator, which drafts from the E6-1 prompt templates (E6-2).

import { LlmError, sumUsage, type JsonSchema, type LlmClient, type LlmUsage } from './client.js';
import { loadPromptTemplate, renderPromptTemplate } from '../generation/templates.js';
import type {
  Generator,
  QueryTranslator,
  ScoringJudge,
  Tag,
  Tagger,
  TaggingInput,
  TaggingResult,
} from './types.js';
import { judgedText, relevanceQuestion } from './judge-question.js';
import { memoizeByIdentity } from '../memo.js';
import { groupByArea } from '../tagging/vocabulary.js';

/** How many tags the tagger asks for per chunk. */
export const TAGS_PER_CHUNK = { min: 3, max: 8 } as const;

/** At most this many tags are translated from one instruction, as many as a chunk gets at most. */
export const MAX_QUERY_TAGS = TAGS_PER_CHUNK.max;

// A list of slugs is short; the margin covers a model that explains itself despite the schema.
const TAGS_MAX_TOKENS = 2000;

const TAGS_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { tags: { type: 'array', items: { type: 'string' } } },
  required: ['tags'],
  additionalProperties: false,
};

const JUDGEMENT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { score: { type: 'number' } },
  required: ['score'],
  additionalProperties: false,
};

// Only a number comes back; the margin covers a model that explains itself despite the schema.
const JUDGEMENT_MAX_TOKENS = 1000;

const JUDGE_SYSTEM_PROMPT = [
  'Du bedömer om en text ur svensk lagstiftning eller rättspraxis är relevant för en jurists uppdrag.',
  'Svara med sannolikheten, från 0 till 1, att svaret på frågan är ja: 1 betyder säkert relevant, 0 säkert inte relevant.',
].join('\n');

// Citations are read from the text itself (E6-2), so the draft is the only field.
const DRAFT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
};

/**
 * Asks for 3–8 tags per chunk with the whole vocabulary in a cached system prompt. Unknown slugs
 * are discarded; when fewer than the minimum remain, one more call says which slugs were invalid.
 */
export function createLlmTagger(client: LlmClient): Tagger {
  // A run passes the same vocabulary for every chunk; build its prompt and slug set once.
  const prepare = memoizeByIdentity((vocabulary: readonly Tag[]) => ({
    system: taggerSystemPrompt(vocabulary),
    known: slugSet(vocabulary),
  }));

  return {
    async tag(chunk, vocabulary) {
      const { system, known } = prepare(vocabulary);
      const usages: LlmUsage[] = [];
      const ask = async (prompt: string) => {
        const { data, usage } = await client.complete({
          system,
          prompt,
          schema: TAGS_SCHEMA,
          maxTokens: TAGS_MAX_TOKENS,
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

/** The vocabulary grouped by area, one `slug: label – description` line per tag. */
function vocabularySections(vocabulary: readonly Tag[]): string {
  return [...groupByArea(vocabulary)]
    .map(([area, tags]) =>
      [`## ${area}`, ...tags.map((tag) => `- ${tag.slug}: ${tag.label} – ${tag.description}`)].join(
        '\n',
      ),
    )
    .join('\n\n');
}

function taggerSystemPrompt(vocabulary: readonly Tag[]): string {
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
    vocabularySections(vocabulary),
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

/**
 * Asks for the tags a search for the instruction should use, with the whole vocabulary in a cached
 * system prompt; unknown and repeated slugs are dropped and at most {@link MAX_QUERY_TAGS} kept.
 */
export function createLlmQueryTranslator(client: LlmClient): QueryTranslator {
  // A server passes the same vocabulary on every query; build its prompt and slug set once.
  const prepare = memoizeByIdentity((vocabulary: readonly Tag[]) => ({
    system: queryTranslatorSystemPrompt(vocabulary),
    known: slugSet(vocabulary),
  }));

  return {
    async translate(instruction, vocabulary, { exclude } = {}) {
      const { system, known } = prepare(vocabulary);
      const { data, usage } = await client.complete({
        system,
        prompt: `Uppdrag:\n${instruction}`,
        schema: TAGS_SCHEMA,
        maxTokens: TAGS_MAX_TOKENS,
        cacheSystem: true,
      });
      const tags = splitSlugs(readStringArray(data, 'tags'), known).valid.filter(
        (slug) => !exclude?.has(slug),
      );
      return { tags: tags.slice(0, MAX_QUERY_TAGS).map((slug) => ({ slug })), usage };
    },
  };
}

function queryTranslatorSystemPrompt(vocabulary: readonly Tag[]): string {
  return [
    'En jurist beskriver ett uppdrag, till exempel ett anställningsavtal eller ett sekretessavtal ' +
      'som ska skrivas. Avsnitt ur svenska lagar och domar har taggats med vokabulären nedan, och ' +
      'taggarna du väljer används för att hitta de avsnitt som juristen behöver.',
    `Välj högst ${MAX_QUERY_TAGS} taggar ur vokabulären. Regler:`,
    '- Använd bara slugs exakt som de står i vokabulären.',
    '- Välj taggar för det uppdraget faktiskt gäller, inklusive frågor som avtalet behöver reglera.',
    '- Föredra specifika taggar framför allmänna när båda passar.',
    '- Lista de viktigaste taggarna först.',
    '- Välj inga taggar alls om uppdraget inte har med vokabulären att göra.',
    '',
    'Vokabulär, grupperad per område (slug: etikett – beskrivning):',
    '',
    vocabularySections(vocabulary),
  ].join('\n');
}

/** Asks the LLM the JEV judge's question, for the probability that the answer is yes. */
export function createLlmJudge(client: LlmClient): ScoringJudge {
  return {
    async judge(instruction, chunk) {
      const { data, usage } = await client.complete({
        system: JUDGE_SYSTEM_PROMPT,
        prompt: `${relevanceQuestion(instruction)}\n\nText:\n${judgedText(chunk)}`,
        schema: JUDGEMENT_SCHEMA,
        maxTokens: JUDGEMENT_MAX_TOKENS,
      });
      const value = readField(data, 'score');
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw invalidResponse('a numeric "score"');
      }
      return { score: Math.min(1, Math.max(0, value)), judgedBy: 'llm', usage };
    },
  };
}

export function createLlmGenerator(client: LlmClient): Generator {
  return {
    async generate({ template, instruction, chunks, parties }) {
      const { system, prompt } = renderPromptTemplate(loadPromptTemplate(template), {
        instruction,
        chunks,
        parties,
      });
      const { data, usage } = await client.complete({ system, prompt, schema: DRAFT_SCHEMA });
      const text = readField(data, 'text');
      if (typeof text !== 'string') throw invalidResponse('a string "text"');
      return { text, usage };
    },
  };
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
