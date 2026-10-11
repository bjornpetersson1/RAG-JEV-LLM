import { readPositiveInteger, readShare } from '../env.js';

export interface TaggingConfig {
  /** How many chunks are tagged at the same time. */
  concurrency: number;
}

export const DEFAULT_TAGGING_CONFIG: TaggingConfig = { concurrency: 4 };

/** Reads `TAGGER_CONCURRENCY`; unset uses the default. */
export function loadTaggingConfig(env: Record<string, string | undefined>): TaggingConfig {
  return {
    concurrency: readPositiveInteger(env, 'TAGGER_CONCURRENCY', DEFAULT_TAGGING_CONFIG.concurrency),
  };
}

export interface ReportConfig {
  /** A tag on more than this share of the tagged chunks is reported as broad. */
  broadShare: number;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = { broadShare: 0.2 };

/** Reads `TAG_REPORT_BROAD_SHARE`; unset uses the default. */
export function loadReportConfig(env: Record<string, string | undefined>): ReportConfig {
  return {
    broadShare: readShare(env, 'TAG_REPORT_BROAD_SHARE', DEFAULT_REPORT_CONFIG.broadShare),
  };
}
