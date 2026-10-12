import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { createTestDatabase } from '../db/test-helpers.js';
import { openQueryDatabase } from './setup.js';

describe('openQueryDatabase', () => {
  let dir: string | undefined;
  let database: ReturnType<typeof createTestDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    if (dir) rmSync(dir, { recursive: true, force: true });
    database = dir = undefined;
  });

  it('opens a migrated database', () => {
    database = createTestDatabase('query-db-');

    const opened = openQueryDatabase(database.path);

    expect('db' in opened).toBe(true);
    if ('db' in opened) opened.db.close();
  });

  it('is unavailable without a database, and creates none', () => {
    dir = mkdtempSync(join(tmpdir(), 'query-db-'));
    const path = join(dir, 'missing.db');

    expect(openQueryDatabase(path)).toEqual({
      unavailable: 'there is no database; run `npm run db:migrate` and the data commands',
    });
    expect(() => openDatabase(path, { readOnly: true })).toThrow();
  });

  it('is unavailable while migrations are pending, naming db:migrate', () => {
    dir = mkdtempSync(join(tmpdir(), 'query-db-'));
    const path = join(dir, 'unmigrated.db');
    openDatabase(path).close();

    const opened = openQueryDatabase(path);

    expect(opened).toMatchObject({
      unavailable: expect.stringMatching(
        /^migrations are pending \(.+\); run `npm run db:migrate`$/,
      ),
    });
  });
});
