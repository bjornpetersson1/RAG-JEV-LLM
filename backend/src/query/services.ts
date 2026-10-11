// The query side shared by the evaluation (E5-3) and the query flow (E6-2): the configured query
// translator, candidate search and chunk loading, built from `.env` and the database.

import type { DatabaseSync } from 'node:sqlite';
import { resolveDatabasePath } from '../db/config.js';
import type { LlmLogger } from '../llm/client.js';
import { loadLlmConfig, roleLabel, type LlmConfig } from '../llm/config.js';
import { createLlmRoles } from '../llm/factory.js';
import type { Chunk, LlmRoles } from '../llm/types.js';
import { createCandidateSearch, type CandidateSearch } from '../search/candidate-search.js';
import { loadSearchConfig, tagIndexBuilder } from '../search/config.js';
import { loadTagIndex } from '../search/load-index.js';
import { VOCABULARY_PATH } from '../tagging/paths.js';
import { loadVocabulary } from '../tagging/vocabulary.js';
import { loadQueryTranslatorConfig } from './config.js';
import { createQueryTranslator } from './factory.js';
import type { TranslationContext } from './translate-query.js';

export interface QueryServices {
  /** What `translateQuery` needs: the configured translator, the vocabulary and its presets. */
  translation: TranslationContext;
  candidateSearch: CandidateSearch;
  /** The chunks with these ids, in the given order; unknown ids are left out. */
  loadChunks(ids: readonly string[]): Chunk[];
  /** E.g. `jev` or `claude-code claude-haiku-5-5`, for reports. */
  translatorLabel: string;
}

export function createQueryServices(
  db: DatabaseSync,
  env: Record<string, string | undefined>,
  logger: LlmLogger,
  llmConfig: LlmConfig = loadLlmConfig(env),
  roles: LlmRoles = createLlmRoles(llmConfig, { logger }),
): QueryServices {
  const vocabulary = loadVocabulary(VOCABULARY_PATH);
  const translatorConfig = loadQueryTranslatorConfig(env);
  const translator = createQueryTranslator(translatorConfig, {
    llmTranslator: roles.queryTranslator,
    logger,
  });
  const searchConfig = loadSearchConfig(env);
  const tagIndex = loadTagIndex(
    resolveDatabasePath(env.DATABASE_PATH),
    tagIndexBuilder(searchConfig),
    logger,
  );
  const selectChunks = db.prepare(
    'SELECT id, text, source_ref FROM chunks WHERE id IN (SELECT value FROM json_each(?))',
  );

  return {
    translation: { translator, vocabulary: vocabulary.tags, presets: vocabulary.presets },
    candidateSearch: createCandidateSearch({ db, tagIndex, config: searchConfig, logger }),
    loadChunks(ids) {
      const rows = selectChunks.all(JSON.stringify(ids.map(Number))) as unknown as ChunkRow[];
      const byId = new Map(rows.map((row) => [String(row.id), row]));
      return ids.flatMap((id): Chunk[] => {
        const row = byId.get(id);
        return row ? [{ id, text: row.text, source: row.source_ref }] : [];
      });
    },
    translatorLabel:
      translatorConfig.impl === 'jev' ? 'jev' : roleLabel(llmConfig, 'queryTranslator'),
  };
}

interface ChunkRow {
  id: number;
  text: string;
  source_ref: string;
}
