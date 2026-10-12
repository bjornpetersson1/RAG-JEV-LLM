import { BGE_RERANKER_MODEL } from '../models/catalog.js';
import { notImplementedReranker } from './not-implemented.js';

/** bge-reranker-v2-m3, a local cross-encoder; a placeholder until E8-3 (#67). */
export const bgeReranker = notImplementedReranker('bge', BGE_RERANKER_MODEL, 'E8-3, #67');
