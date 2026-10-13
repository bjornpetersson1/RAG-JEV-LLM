import { describe, expect, it } from 'vitest';
import type { PostCheck, ReferenceFlag, ReferenceMatch } from './query';
import { linkReferences } from './references';

const link = (id: string) => `#source-main-${id}`;

/** The post-check of `text` with these references, each found by what it says. */
function check(
  text: string,
  matches: [written: string, chunkId: string][],
  flags: [written: string, reason: string, chunkId?: string][] = [],
): PostCheck {
  const at = (written: string) => {
    const start = text.indexOf(written);
    return { text: written, start, end: start + written.length };
  };
  const kind = (written: string) => (written.startsWith('[K:') ? 'citation' : 'free-text');
  return {
    matches: matches.map(([written, chunkId]): ReferenceMatch => ({
      kind: kind(written),
      ...at(written),
      chunkId,
    })),
    flags: flags.map(([written, reason, chunkId]): ReferenceFlag => ({
      kind: kind(written),
      ...at(written),
      reason,
      ...(chunkId && { chunkId }),
    })),
    references: matches.length + flags.length,
    valid: matches.length,
    sourceAccuracy: null,
  };
}

describe('linkReferences', () => {
  it('links a citation to its chunk, escaping the brackets', () => {
    const text = 'Lön [K:1].';

    expect(linkReferences(text, check(text, [['[K:1]', '1']]), link)).toBe(
      'Lön [\\[K:1\\]](#source-main-1).',
    );
  });

  it('gives each id of a group its own link, a flagged id a flag link with the reason', () => {
    const text = 'Se [K:2, K:9].';

    expect(
      linkReferences(
        text,
        check(text, [['[K:2, K:9]', '2']], [['[K:2, K:9]', 'chunk 9 was not submitted', '9']]),
        link,
      ),
    ).toBe('Se [\\[K:2\\]](#source-main-2)[\\[K:9\\]](#flag "chunk 9 was not submitted").');
  });

  it('reads a group as the backend does, also without K: after the first id', () => {
    const text = 'Se [K:11, 12].';

    expect(
      linkReferences(
        text,
        check(text, [
          ['[K:11, 12]', '11'],
          ['[K:11, 12]', '12'],
        ]),
        link,
      ),
    ).toBe('Se [\\[K:11\\]](#source-main-11)[\\[K:12\\]](#source-main-12).');
  });

  it('keeps the written order when one id is a prefix of another', () => {
    const text = 'Se [K:12, K:1].';

    expect(
      linkReferences(
        text,
        check(text, [
          ['[K:12, K:1]', '1'],
          ['[K:12, K:1]', '12'],
        ]),
        link,
      ),
    ).toBe('Se [\\[K:12\\]](#source-main-12)[\\[K:1\\]](#source-main-1).');
  });

  it('keeps an id it has no reference for as written, so nothing in the draft disappears', () => {
    const text = 'Se [K:1, K:x].';

    expect(linkReferences(text, check(text, [['[K:1, K:x]', '1']]), link)).toBe(
      'Se [\\[K:1\\]](#source-main-1)\\[K:x\\].',
    );
  });

  it('links a matched free-text reference and flags an unmatched one', () => {
    const text = 'Enligt 7 § LAS och AD 2010 nr 61.';

    expect(
      linkReferences(text, check(text, [['7 § LAS', '2']], [['AD 2010 nr 61', 'no chunk']]), link),
    ).toBe('Enligt [7 § LAS](#source-main-2) och [AD 2010 nr 61](#flag "no chunk").');
  });

  it.each([
    ['a code span', 'Se `7 § LAS` nedan.'],
    ['an existing link', 'Se [enligt 7 § LAS](https://lagen.nu/1982:80).'],
  ])('leaves a reference inside %s as written', (_case, text) => {
    expect(linkReferences(text, check(text, [['7 § LAS', '2']]), link)).toBe(text);
  });

  it('leaves a draft without references as it is', () => {
    expect(linkReferences('# Avtal\n\nText.', check('# Avtal\n\nText.', []), link)).toBe(
      '# Avtal\n\nText.',
    );
  });
});
