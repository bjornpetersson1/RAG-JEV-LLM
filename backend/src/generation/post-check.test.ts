import { describe, expect, it } from 'vitest';
import { findFreeTextReferences } from '../legal/references.js';
import type { Chunk } from '../llm/types.js';
import { checkDraft } from './post-check.js';

function chunk(id: string, source?: string): Chunk {
  return { id, text: 'text', source };
}

/** The flagged texts of a draft checked against chunks with these source references. */
function flagged(text: string, sources: string[]): string[] {
  const chunks = sources.map((source, i) => chunk(String(i + 1), source));
  return checkDraft(text, chunks).flags.map((flag) => flag.text);
}

describe('checkDraft: [K:] citations', () => {
  const SUBMITTED = [chunk('11'), chunk('12')];

  it('flags a citation of an id that was not submitted, at the citation', () => {
    const text = 'Lön [K:11]. Påhittat [K:99].';

    const check = checkDraft(text, SUBMITTED);

    expect(check.flags).toEqual([
      {
        kind: 'citation',
        text: '[K:99]',
        start: 21,
        end: 27,
        reason: 'chunk 99 was not submitted',
        chunkId: '99',
      },
    ]);
    expect(text.slice(21, 27)).toBe('[K:99]');
  });

  it('checks each id of a bracket group on its own', () => {
    const check = checkDraft('Se [K:11, K:40].', SUBMITTED);

    expect(check.flags.map((f) => [f.text, f.chunkId, f.reason])).toEqual([
      ['[K:11, K:40]', '40', 'chunk 40 was not submitted'],
    ]);
    expect(check).toMatchObject({ references: 2, valid: 1 });
  });

  it('flags a chunk that was approved but cut by the context limit, since it was not submitted', () => {
    // 21 was approved by the judge but left out by the limits, so only 11 and 12 were submitted.
    expect(checkDraft('Klausul [K:21].', SUBMITTED).flags.map((f) => f.text)).toEqual(['[K:21]']);
  });

  it('does not flag citations of submitted chunks', () => {
    expect(checkDraft('A [K:11]. B [K:12][K:11].', SUBMITTED).flags).toEqual([]);
  });
});

describe('checkDraft: source accuracy', () => {
  it('is the share of valid references, every occurrence counted', () => {
    const check = checkDraft('A [K:1]. B [K:1]. C [K:9]. Enligt 7 § LAS och 8 § LAS.', [
      chunk('1', 'SFS 1982:80 7 §'),
    ]);

    expect(check).toMatchObject({ references: 5, valid: 3, sourceAccuracy: 3 / 5 });
    expect(check.flags.map((f) => f.text)).toEqual(['[K:9]', '8 § LAS']);
  });

  it('is null, not 100 %, for a draft without references', () => {
    expect(checkDraft('Inga hänvisningar alls.', [chunk('1')])).toEqual({
      flags: [],
      matches: [],
      references: 0,
      valid: 0,
      sourceAccuracy: null,
    });
  });
});

describe('checkDraft: free-text references', () => {
  it('accepts "7 § LAS" when SFS 1982:80 7 § was submitted and flags it when only 8 § was', () => {
    expect(flagged('Enligt 7 § LAS.', ['SFS 1982:80 7 §'])).toEqual([]);
    expect(flagged('Enligt 7 § LAS.', ['SFS 1982:80 8 §'])).toEqual(['7 § LAS']);
  });

  it('gives the position and reason of a flagged provision', () => {
    const [flag] = checkDraft('Se 8 § LAS.', [chunk('1', 'SFS 1982:80 7 §')]).flags;

    expect(flag).toEqual({
      kind: 'free-text',
      text: '8 § LAS',
      start: 3,
      end: 10,
      reason: 'no submitted chunk is from SFS 1982:80 8 §',
    });
  });

  it('matches chapter references, and a section without a chapter in any chapter', () => {
    expect(flagged('Enligt 2 kap. 9 § diskrimineringslagen.', ['SFS 2008:567 2 kap. 9 §'])).toEqual(
      [],
    );
    expect(flagged('Enligt 3 kap. 9 § diskrimineringslagen.', ['SFS 2008:567 2 kap. 9 §'])).toEqual(
      ['3 kap. 9 § diskrimineringslagen'],
    );
    expect(flagged('Enligt 9 § DL.', ['SFS 2008:567 2 kap. 9 §'])).toEqual([]);
  });

  it('ignores paragraphs and split suffixes in the source reference', () => {
    expect(flagged('Enligt 7 § första stycket LAS.', ['SFS 1982:80 7 § st. 2 (2)'])).toEqual([]);
    expect(flagged('Enligt 6 c § LAS.', ['SFS 1982:80 6 c § st. 2, del 1/2'])).toEqual([]);
    expect(flagged('Enligt 33 d § LAS.', ['SFS 1982:80 33 d §'])).toEqual([]);
  });

  it('reads "lagen (1982:80)" and "SFS 1977:480" as whole statutes', () => {
    expect(flagged('Enligt lagen (1982:80) om anställningsskydd.', ['SFS 1982:80 7 §'])).toEqual(
      [],
    );
    expect(flagged('Enligt 7 § lagen (1982:80).', ['SFS 1982:80 7 §'])).toEqual([]);
    expect(flagged('Se SFS 1977:480.', ['SFS 1982:80 7 §'])).toEqual(['SFS 1977:480']);
    expect(flagged('Se SFS 1977:480.', ['SFS 1977:480 12 §'])).toEqual([]);
  });

  it('reads a known law name or abbreviation alone as the whole statute', () => {
    expect(flagged('Semester enligt semesterlagen.', ['SFS 1982:80 7 §'])).toEqual([
      'semesterlagen',
    ]);
    expect(flagged('Prövas enligt 38 § avtalslagen.', ['SFS 1915:218 38 §'])).toEqual([]);
    expect(flagged('Enligt MBL.', ['SFS 1976:580 11 §'])).toEqual([]);
  });

  it('matches AD and NJA cases on their identifier', () => {
    expect(flagged('Jfr AD 2019 nr 35.', ['AD 2019 nr 35, Domskäl, del 1/2'])).toEqual([]);
    expect(flagged('Jfr AD 2019 nr 35.', ['AD 2019 nr 3, Domskäl'])).toEqual(['AD 2019 nr 35']);
    expect(flagged('Jfr NJA 2015 s. 123.', ['NJA 2015 s. 123, Domskäl, del 1/2'])).toEqual([]);
    expect(flagged('Jfr NJA 2015 s. 123.', ['NJA 2015 s. 741'])).toEqual(['NJA 2015 s. 123']);
  });

  it('does not read the id inside a [K:] citation as a reference', () => {
    const check = checkDraft('Lön [K:1982]. Text [K:2019, K:35].', [
      chunk('1982'),
      chunk('2019'),
      chunk('35'),
    ]);

    expect(check).toMatchObject({ flags: [], references: 3, valid: 3 });
  });

  it('reads other paragraph forms, so the section is still checked', () => {
    expect(flagged('Enligt 8 § 2 st. LAS.', ['SFS 1982:80 7 §'])).toEqual(['8 § 2 st. LAS']);
    expect(flagged('Se 8 § första och andra stycket LAS.', ['SFS 1982:80 7 §'])).toEqual([
      '8 § första och andra stycket LAS',
    ]);
  });

  it('checks every section of a "7 och 8 §§" list', () => {
    const check = checkDraft('Enligt 7 och 8 §§ LAS.', [chunk('1', 'SFS 1982:80 7 §')]);

    expect(check).toMatchObject({ references: 2, valid: 1 });
    expect(check.flags.map((f) => [f.text, f.reason])).toEqual([
      ['7 och 8 §§ LAS', 'no submitted chunk is from SFS 1982:80 8 §'],
    ]);
  });

  it('does not count a law name right after an unread provision as a whole-statute reference', () => {
    expect(checkDraft('Se 7 § i LAS.', [chunk('1', 'SFS 1982:80 8 §')])).toMatchObject({
      references: 0,
    });
  });

  it('reads a provision followed by a bare SFS number in parentheses', () => {
    expect(flagged('Enligt 8 § (1982:80).', ['SFS 1982:80 7 §'])).toEqual(['8 § (1982:80)']);
  });

  it('reads law names in the genitive', () => {
    expect(flagged('Enligt semesterlagens regler.', ['SFS 1982:80 7 §'])).toEqual([
      'semesterlagens',
    ]);
    expect(flagged('Enligt LAS:s regler.', ['SFS 1982:80 7 §'])).toEqual([]);
  });

  it('counts a law named by number and abbreviation together once', () => {
    const check = checkDraft('Enligt lagen (1982:80) om anställningsskydd (LAS).', [
      chunk('1', 'SFS 1977:480 1 §'),
    ]);

    expect(check.flags.map((f) => f.text)).toEqual(['lagen (1982:80)']);
    expect(check.references).toBe(1);
  });

  it('reads "NJA 2015 s 123" without the dot', () => {
    expect(flagged('Se NJA 2015 s 123.', ['NJA 2015 s. 741'])).toEqual(['NJA 2015 s 123']);
    expect(flagged('Se NJA 2015 s 123.', ['NJA 2015 s. 123, Domskäl'])).toEqual([]);
  });

  it('does not let an unclosed [K: hide later references', () => {
    const check = checkDraft('Se 7 § LAS [K:1\n\nVidare 8 § LAS. [K:1]', [
      chunk('1', 'SFS 1982:80 7 §'),
    ]);

    expect(check.flags.map((f) => f.text)).toEqual(['8 § LAS']);
  });

  it('does not detect an abbreviation outside the table or a section without a law', () => {
    expect(findFreeTextReferences('Enligt 7 § XYZ och enligt 7 §. Se även LASER.')).toEqual([]);
  });
});

describe('checkDraft: matches', () => {
  it('links each valid citation, also in a group, and each matched free-text reference to its chunk', () => {
    const text = 'Lön [K:1]. Uppsägning enligt 7 § LAS [K:2, K:9].';
    const submitted = [
      { id: '1', text: 'a', source: 'SFS 1982:80 11 §' },
      { id: '2', text: 'b', source: 'SFS 1982:80 7 §' },
    ];

    const { matches, flags } = checkDraft(text, submitted);

    expect(matches).toEqual([
      { kind: 'citation', text: '[K:1]', start: 4, end: 9, chunkId: '1' },
      { kind: 'free-text', text: '7 § LAS', start: 29, end: 36, chunkId: '2' },
      { kind: 'citation', text: '[K:2, K:9]', start: 37, end: 47, chunkId: '2' },
    ]);
    expect(flags.map(({ chunkId }) => chunkId)).toEqual(['9']);
  });
});
