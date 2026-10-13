// The local models' Hugging Face repositories (ONNX exports; licences in the README).

import type { ModelDtype } from './config.js';

/** bge-m3's ONNX export; it gives the dense vector only, not the sparse lexical weights. */
export const BGE_M3_MODEL = 'Xenova/bge-m3';

/** A cross-encoder the rerankers run, and how its repository stores its ONNX files. */
export interface CrossEncoderModel {
  /** The Hugging Face repository. */
  id: string;
  /** The longest (instruction, chunk) pair it scores; a longer one is cut. */
  maxTokens: number;
  /** Whether the fp32 weights are in a separate `.onnx_data` file the config does not declare. */
  fp32ExternalData?: boolean;
  /** The ONNX file per precision, when it is not transformers.js's default name. */
  files?: Partial<Record<ModelDtype, string>>;
}

/**
 * bge-reranker-v2-m3's ONNX export. At most 1,024 tokens: chunks (at most 2,000 characters) fit
 * with room to spare, and the model's own limit (8,192) would be slow.
 */
export const BGE_RERANKER: CrossEncoderModel = {
  id: 'onnx-community/bge-reranker-v2-m3-ONNX',
  maxTokens: 1024,
  fp32ExternalData: true,
};

/**
 * mMiniLM-L12 trained on mMARCO (E7-5), about 118M parameters. Its position limit is 512 tokens. Its
 * int8 exports are quantised per processor: AVX2 for x86 (the demo machine), and one for ARM (Apple
 * Silicon), which has no AVX2.
 */
export const MMINILM_RERANKER: CrossEncoderModel = {
  id: 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1',
  maxTokens: 512,
  files: { int8: process.arch === 'arm64' ? 'model_qint8_arm64' : 'model_quint8_avx2' },
};
