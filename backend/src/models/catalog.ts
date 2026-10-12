// The local models' Hugging Face repositories (ONNX exports; licences in the README).

/** bge-m3's ONNX export; it gives the dense vector only, not the sparse lexical weights. */
export const BGE_M3_MODEL = 'Xenova/bge-m3';

/** bge-reranker-v2-m3's ONNX export, a cross-encoder. */
export const BGE_RERANKER_MODEL = 'onnx-community/bge-reranker-v2-m3-ONNX';

/**
 * The longest (instruction, chunk) pair the reranker scores; a longer one is cut. Chunks (at most
 * 2,000 characters) fit with room to spare, and the model's own limit (8,192) would be slow.
 */
export const BGE_RERANKER_MAX_TOKENS = 1024;
