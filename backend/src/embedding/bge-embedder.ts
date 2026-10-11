import type { EmbedderEntry } from './types.js';

const MODEL = 'BAAI/bge-m3';

/** bge-m3, dense and sparse; a placeholder until E8-2 (#66). */
export const bgeEmbedder: EmbedderEntry = {
  validate() {},
  create() {
    return {
      name: 'bge',
      model: MODEL,
      embed() {
        return Promise.reject(new Error('EMBEDDER=bge is not implemented yet (E8-2, #66)'));
      },
    };
  },
};
