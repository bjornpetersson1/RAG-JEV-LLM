import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Chunk } from '../llm/types.js';
import { REPO_ROOT } from '../repo-root.js';
import { isTemplate, TEMPLATES, type Template } from '../tagging/vocabulary.js';

export const PROMPTS_DIR = join(REPO_ROOT, 'prompts');

/** The parts of a template file, by their `##` heading (see prompts/README.md). */
const PARTS = {
  system: 'System',
  user: 'Användare',
  defaultParties: 'Standardparter',
  disclaimer: 'Friskrivning',
} as const;

type Part = keyof typeof PARTS;

/** The slots each part must contain. */
const SLOTS: Partial<Record<Part, readonly string[]>> = {
  system: ['disclaimer'],
  user: ['instruction', 'parties', 'chunks'],
};

// Anything in double braces, so a misspelt slot such as `{{ lön }}` is reported, not sent as is.
const SLOT_PATTERN = /\{\{([^}]*)\}\}/g;

// A bracket group of citations: `[K:12]`, or several ids as `[K:12, K:40]` or `[K:12, 40]`.
const CITATION_GROUP_PATTERN = /\[K:([^\]]*)\]/g;

/** One cited chunk id, with the offsets of the bracket group it was written in. */
export interface FoundCitation {
  id: string;
  start: number;
  end: number;
}

export type PromptTemplate = { id: Template } & Record<Part, string>;

export interface PromptInput {
  instruction: string;
  /** Approved chunks, in the order the model should see them. */
  chunks: readonly Chunk[];
  /** The contract parties; the template's fictional default parties when absent. */
  parties?: string;
}

export interface RenderedPrompt {
  system: string;
  prompt: string;
}

const loaded = new Map<string, PromptTemplate>();

/** Loads and validates the prompt template for a template id; each file is read once. */
export function loadPromptTemplate(id: string, dir = PROMPTS_DIR): PromptTemplate {
  if (!isTemplate(id)) {
    throw new Error(`Unknown template "${id}": expected one of ${TEMPLATES.join(', ')}`);
  }
  const path = join(dir, `${id}.md`);
  let template = loaded.get(path);
  if (!template) {
    template = { id, ...parsePromptTemplate(readFileSync(path, 'utf8'), path) };
    loaded.set(path, template);
  }
  return template;
}

/** Splits a template file into its parts and checks that each part has its slots. */
export function parsePromptTemplate(text: string, source: string): Record<Part, string> {
  const sections = new Map<string, string>();
  const errors: string[] = [];
  const known: readonly string[] = Object.values(PARTS);
  for (const [heading, body] of splitSections(text)) {
    if (!known.includes(heading)) errors.push(`unknown part "## ${heading}"`);
    else if (sections.has(heading)) errors.push(`"## ${heading}" appears more than once`);
    else sections.set(heading, body);
  }
  const parts = {} as Record<Part, string>;
  for (const [part, heading] of Object.entries(PARTS) as [Part, string][]) {
    const body = sections.get(heading);
    if (body === undefined) {
      errors.push(`missing the "## ${heading}" part`);
      continue;
    }
    if (body === '') {
      errors.push(`"## ${heading}" is empty`);
      continue;
    }
    parts[part] = body;
    const slots = SLOTS[part] ?? [];
    for (const slot of slots) {
      if (!body.includes(`{{${slot}}}`)) errors.push(`"## ${heading}" has no {{${slot}}} slot`);
    }
    for (const [, slot] of body.matchAll(SLOT_PATTERN)) {
      if (!slots.includes(slot)) errors.push(`"## ${heading}" has an unknown slot {{${slot}}}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Invalid prompt template ${source}:\n${errors.map((e) => `- ${e}`).join('\n')}`,
    );
  }
  return parts;
}

/**
 * Fills the slots of a template, giving the system prompt and the user prompt of the call. A draft
 * needs sources, so at least one chunk is required.
 */
export function renderPromptTemplate(template: PromptTemplate, input: PromptInput): RenderedPrompt {
  if (input.chunks.length === 0) throw new Error('A draft needs at least one chunk');
  const values: Record<string, string> = {
    disclaimer: template.disclaimer,
    instruction: input.instruction.trim(),
    parties: input.parties?.trim() || template.defaultParties,
    chunks: formatChunks(input.chunks),
  };
  return { system: fillSlots(template.system, values), prompt: fillSlots(template.user, values) };
}

/** The citation of a chunk, as the templates ask the model to write it. */
export function citation(chunkId: string): string {
  return `[K:${chunkId}]`;
}

/** Every chunk id cited in a draft, in text order, one entry per id even inside a group. */
export function findCitations(text: string): FoundCitation[] {
  return [...text.matchAll(CITATION_GROUP_PATTERN)].flatMap((match) => {
    const start = match.index;
    const end = start + match[0].length;
    return match[1]
      .split(',')
      .map((item) => item.trim().replace(/^K:\s*/, ''))
      .filter((id) => id !== '')
      .map((id) => ({ id, start, end }));
  });
}

function formatChunks(chunks: readonly Chunk[]): string {
  return chunks
    .map((chunk) => {
      const heading = chunk.source ? `${citation(chunk.id)} ${chunk.source}` : citation(chunk.id);
      return `${heading}\n${chunk.text.trim()}`;
    })
    .join('\n\n');
}

// One pass, so a value that contains "{{…}}" (e.g. in the instruction) is never filled itself.
function fillSlots(text: string, values: Record<string, string>): string {
  return text.replace(SLOT_PATTERN, (slot, name: string) => values[name] ?? slot);
}

/** Each `## ` heading with the trimmed body under it, in file order. */
function splitSections(text: string): [heading: string, body: string][] {
  // Splitting on a capturing group gives [preamble, heading, body, heading, body, …].
  const [, ...parts] = text.replace(/\r\n/g, '\n').split(/^## (.+)$/m);
  const sections: [string, string][] = [];
  for (let i = 0; i < parts.length; i += 2) sections.push([parts[i].trim(), parts[i + 1].trim()]);
  return sections;
}
