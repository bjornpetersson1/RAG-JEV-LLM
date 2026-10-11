import type { Chunk } from '../llm/types.js';
import { sum } from '../stats.js';
import type { ContextLimits } from './config.js';

export type ContextLimit = keyof ContextLimits;

export interface ContextSelection {
  /** The chunks sent to the generator, in the given order. */
  submitted: Chunk[];
  /** Approved chunks the limits kept out, in the given order. */
  leftOut: Chunk[];
  /** The limits that kept chunks out; empty when every chunk was sent. */
  limitedBy: ContextLimit[];
  /** The smallest limits that would have sent every chunk. */
  needed: ContextLimits;
}

/**
 * Takes chunks in the given order (best first) while both limits hold. A chunk too long for the
 * remaining character budget is skipped, so a shorter one further down may still fit.
 */
export function selectContext(chunks: readonly Chunk[], limits: ContextLimits): ContextSelection {
  const submitted: Chunk[] = [];
  const leftOut: Chunk[] = [];
  const limitedBy = new Set<ContextLimit>();
  let chars = 0;
  for (const chunk of chunks) {
    if (submitted.length >= limits.maxChunks) {
      leftOut.push(chunk);
      limitedBy.add('maxChunks');
    } else if (chars + chunk.text.length > limits.maxContextChars) {
      leftOut.push(chunk);
      limitedBy.add('maxContextChars');
    } else {
      submitted.push(chunk);
      chars += chunk.text.length;
    }
  }
  return {
    submitted,
    leftOut,
    limitedBy: [...limitedBy],
    needed: {
      maxChunks: chunks.length,
      maxContextChars: sum(chunks.map((chunk) => chunk.text.length)),
    },
  };
}
