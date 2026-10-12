import { readOneOf, type Env } from '../env.js';
import { bgeEmbedder } from './bge-embedder.js';
import type { Embedder, EmbedderEntry } from './types.js';

/** Every `EMBEDDER` value and its implementation. */
export const EMBEDDERS: Readonly<Record<string, EmbedderEntry>> = { bge: bgeEmbedder };

const DEFAULT_EMBEDDER = 'bge';

/** Reads `EMBEDDER` (default `bge`) and validates the chosen embedder's settings; returns its name. */
export function loadEmbedderConfig(env: Env, registry = EMBEDDERS): string {
  const name = selectEmbedder(env, registry);
  registry[name].validate(env);
  return name;
}

/** The embedder `EMBEDDER` selects; it reads its own settings once. */
export function createEmbedder(env: Env, registry = EMBEDDERS): Embedder {
  return registry[selectEmbedder(env, registry)].create(env);
}

function selectEmbedder(env: Env, registry: Readonly<Record<string, EmbedderEntry>>): string {
  return readOneOf(env, 'EMBEDDER', Object.keys(registry), DEFAULT_EMBEDDER);
}
