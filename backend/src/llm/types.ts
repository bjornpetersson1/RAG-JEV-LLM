import type { LlmUsage } from './client.js';

export const ROLE_NAMES = ['tagger', 'queryTranslator', 'judge', 'generator'] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export interface Tag {
  slug: string;
  label: string;
  /** A Swedish phrase that completes "Handlar texten om …?". */
  description: string;
  /** The vocabulary area the tag belongs to, e.g. `sekretess`. */
  area: string;
}

export interface TaggingInput {
  text: string;
  /** Document title and heading path, e.g. "Lag (1982:80) om anställningsskydd › 7 §". */
  context?: string;
  /** Where the text comes from, e.g. "SFS 1982:80 7 §". */
  source?: string;
}

export interface TaggingResult {
  /** Known, unique slugs in the model's order, at most the maximum per chunk. */
  tags: string[];
  /** Slugs the model returned that are not in the vocabulary. */
  discarded: string[];
  /** Known slugs left out because the model returned more than the maximum. */
  overLimit: string[];
  /** Whether a second call was made because too few known tags came back. */
  retried: boolean;
  /** Tokens used by all calls for this chunk. */
  usage: LlmUsage;
}

export interface Chunk {
  id: string;
  text: string;
  /** Where the text comes from, e.g. "SFS 1982:80 7 §" or a case reference. */
  source?: string;
}

export interface Judgement {
  relevant: boolean;
  /** Probability-like relevance score between 0 and 1. */
  score: number;
}

export interface GenerateInput {
  template: string;
  instruction: string;
  chunks: readonly Chunk[];
}

export interface Draft {
  text: string;
  /** Ids of the chunks the draft cites. */
  references: string[];
}

export interface Tagger {
  tag(chunk: TaggingInput, vocabulary: readonly Tag[]): Promise<TaggingResult>;
}

export interface QueryTranslator {
  translate(instruction: string, vocabulary: readonly Tag[]): Promise<string[]>;
}

export interface Judge {
  judge(instruction: string, chunk: Chunk): Promise<Judgement>;
}

export interface Generator {
  generate(input: GenerateInput): Promise<Draft>;
}

export interface LlmRoles {
  tagger: Tagger;
  queryTranslator: QueryTranslator;
  judge: Judge;
  generator: Generator;
}
