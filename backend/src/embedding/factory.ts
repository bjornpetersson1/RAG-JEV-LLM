import { readOneOf, type Env } from '../env.js';
import { bgeEmbedder } from './bge-embedder.js';
import type { Embedder, EmbedderEntry } from './types.js';

/** Every `EMBEDDER` value and its implementation. */
export const EMBEDDERS: Readonly<Record<string, EmbedderEntry>> = { bge: bgeEmbedder };

/** Reads `EMBEDDER` (default `bge`) and validates the chosen embedder's settings; returns its name. */
export function loadEmbedderConfig(env: Env, registry = EMBEDDERS): string {
  const name = readOneOf(env, 'EMBEDDER', Object.keys(registry), 'bge');
  registry[name].validate(env);
  return name;
}

/** The embedder `EMBEDDER` selects. */
export function createEmbedder(env: Env, registry = EMBEDDERS): Embedder {
  return registry[readOneOf(env, 'EMBEDDER', Object.keys(registry), 'bge')].create(env);
}
