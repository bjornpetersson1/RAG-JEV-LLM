// The `bge` reranker (E8-3): bge-reranker-v2-m3, about 568M parameters, run locally.

import { BGE_RERANKER } from '../models/catalog.js';
import { crossEncoderReranker } from './cross-encoder-reranker.js';

export const bgeReranker = crossEncoderReranker({ name: 'bge', model: BGE_RERANKER });
