export const ROLE_NAMES = ['tagger', 'queryTranslator', 'judge', 'generator'] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export interface Tag {
  name: string;
  description?: string;
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
  tag(chunkText: string, vocabulary: readonly Tag[]): Promise<string[]>;
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
