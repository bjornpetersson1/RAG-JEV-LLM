import { afterEach, describe, expect, it } from 'vitest';
import { createEvalDatabase } from '../eval/test-helpers.js';
import { createChunkLoader } from './services.js';

describe('createChunkLoader', () => {
  let database: ReturnType<typeof createEvalDatabase> | undefined;

  afterEach(() => {
    database?.remove();
    database = undefined;
  });

  it('loads chunks in the given order with their document’s title and source URL', () => {
    const { db } = (database = createEvalDatabase());
    db.exec(`UPDATE documents SET source_url = 'https://lagen.nu/1982:80' WHERE id = 1`);

    const chunks = createChunkLoader(db)(['21', '11', '99']);

    expect(chunks).toEqual([
      {
        id: '21',
        text: 'Konkurrensklausulen är oskälig.',
        source: 'AD 2015 nr 8, Domskäl, del 1/5',
        context: '',
        document: { title: 'Konkurrensklausul' },
      },
      {
        id: '11',
        text: 'Uppsägning ska vara sakligt grundad.',
        source: 'SFS 1982:80 7 §',
        context: '',
        document: { title: 'Lag (1982:80) om anställningsskydd', url: 'https://lagen.nu/1982:80' },
      },
    ]);
  });
});
