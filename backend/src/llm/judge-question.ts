// What every judge is asked, so JEV, SubQ and the LLM judge the same text against the same question.

import type { Chunk } from './types.js';

/**
 * The yes/no question about the chunk, e.g. "Är texten relevant för följande uppdrag: …?". The
 * instruction's own closing punctuation is dropped so the question ends in exactly one "?".
 */
export function relevanceQuestion(instruction: string): string {
  const task = instruction.trim().replace(/[\s.?!]+$/, '');
  if (!task) throw new Error('An instruction is required to judge relevance');
  return `Är texten relevant för följande uppdrag: ${task}?`;
}

/** The text judged: the chunk's source reference, a blank line and its text (only the text without a source). */
export function judgedText(chunk: Chunk): string {
  return chunk.source ? `${chunk.source}\n\n${chunk.text}` : chunk.text;
}
