// Builds the evaluation's dependencies from `.env` and the database: the configured query
// translator and candidate search (all the label tool needs), and one judge per judge mode.

import type { DatabaseSync } from 'node:sqlite';
import { resolveDatabasePath } from '../db/config.js';
import { loadJudgeConfig, loadJudgingConfig } from '../judge/config.js';
import { createJudging } from '../judge/factory.js';
import { judgeAll } from '../judge/judge-all.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, roleModel, type LlmConfig } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import type { Chunk } from '../llm/types.js';
import { loadQueryTranslatorConfig } from '../query/config.js';
import { createQueryTranslator } from '../query/factory.js';
import { translateQuery } from '../query/translate-query.js';
import { createCandidateSearch } from '../search/candidate-search.js';
import { loadSearchConfig, tagIndexBuilder } from '../search/config.js';
import { loadTagIndex } from '../search/load-index.js';
import { VOCABULARY_PATH } from '../tagging/paths.js';
import { loadVocabulary } from '../tagging/vocabulary.js';
import {
  byJudgeMode,
  type EvalDependencies,
  type JudgeMode,
  type SearchDependencies,
} from './run.js';

type Env = Record<string, string | undefined>;

/** The judge implementation each judge mode forces, whatever `JUDGE_IMPL` says. */
const JUDGE_IMPL_FOR: Record<JudgeMode, string> = {
  'tags+jev': 'jev-with-fallback',
  'tags+llm': 'llm',
};

export interface SearchSetup extends SearchDependencies {
  /** What the run used, for the report, e.g. `{ 'query translator': 'claude-code claude-haiku-5-5' }`. */
  settings: Record<string, string>;
}

export type EvalSetup = SearchSetup & Omit<EvalDependencies, 'onQuery'>;

/** The query translator and candidate search `.env` configures. */
export function createSearchSetup(
  db: DatabaseSync,
  env: Env,
  logger: LlmLogger,
  llmConfig = loadLlmConfig(env),
): SearchSetup {
  const vocabulary = loadVocabulary(VOCABULARY_PATH);
  const translatorConfig = loadQueryTranslatorConfig(env);
  const translator = createQueryTranslator(translatorConfig, {
    llmTranslator: createLlmRoles(llmConfig, { logger }).queryTranslator,
    logger,
  });
  const searchConfig = loadSearchConfig(env);
  const tagIndex = loadTagIndex(
    resolveDatabasePath(env.DATABASE_PATH),
    tagIndexBuilder(searchConfig),
    logger,
  );
  const candidateSearch = createCandidateSearch({ db, tagIndex, config: searchConfig, logger });
  const selectChunks = db.prepare(
    'SELECT id, text, source_ref FROM chunks WHERE id IN (SELECT value FROM json_each(?))',
  );

  return {
    settings: {
      'query translator':
        translatorConfig.impl === 'jev' ? 'jev' : roleLabel(llmConfig, 'queryTranslator'),
      'LLM judge': roleLabel(llmConfig, 'judge'),
    },
    async translate(query) {
      const { tags } = await translateQuery(query, {
        translator,
        vocabulary: vocabulary.tags,
        presets: vocabulary.presets,
      });
      return tags.map((tag) => tag.slug);
    },
    search(query, tags, mode) {
      const { candidates } = candidateSearch.search({ instruction: query.instruction, tags, mode });
      return candidates.map((candidate) => String(candidate.chunkId));
    },
    loadChunks(ids) {
      const rows = selectChunks.all(JSON.stringify(ids.map(Number))) as unknown as ChunkRow[];
      const byId = new Map(rows.map((row) => [String(row.id), row]));
      return ids.flatMap((id): Chunk[] => {
        const row = byId.get(id);
        return row ? [{ id, text: row.text, source: row.source_ref }] : [];
      });
    },
  };
}

/** The search setup plus one judge per judge mode, judging with the cache on. */
export function createEvalSetup(db: DatabaseSync, env: Env, logger: LlmLogger): EvalSetup {
  const llmConfig = loadLlmConfig(env);
  const judgingConfig = loadJudgingConfig(env);
  const judgings = byJudgeMode((mode) =>
    createJudging(loadJudgeConfig({ ...env, JUDGE_IMPL: JUDGE_IMPL_FOR[mode] }), {
      llmConfig,
      logger,
    }),
  );
  return {
    ...createSearchSetup(db, env, logger, llmConfig),
    judge(mode, instruction, chunks) {
      return judgeAll(
        instruction,
        chunks,
        { judging: judgings[mode], config: judgingConfig, db, logger },
        { cache: true },
      );
    },
    judges: byJudgeMode((mode) => judgings[mode].primary),
  };
}

/** E.g. `claude-code claude-haiku-5-5`. */
function roleLabel(llmConfig: LlmConfig, role: 'queryTranslator' | 'judge'): string {
  return `${llmConfig.roles[role].provider} ${roleModel(llmConfig, role)}`;
}

interface ChunkRow {
  id: number;
  text: string;
  source_ref: string;
}
