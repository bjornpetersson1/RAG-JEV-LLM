// The `minilm` reranker (E7-5): mMiniLM-L12 trained on mMARCO, about 118M parameters, run locally.

import { MMINILM_RERANKER } from '../models/catalog.js';
import { crossEncoderReranker } from './cross-encoder-reranker.js';

export const minilmReranker = crossEncoderReranker({ name: 'minilm', model: MMINILM_RERANKER });
