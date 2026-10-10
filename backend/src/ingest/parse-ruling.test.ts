import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RulingParseError, WHOLE_RULING_HEADING, parseRulingRecord } from './parse-ruling.js';
import type { RulingSection } from './structure.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** A case-law API record around `paragraphs`, with the fields the parser reads. */
function record(paragraphs: string[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    domstol: { domstolKod: 'ADO' },
    avgorandedatum: '2024-02-14',
    referatNummerLista: ['AD 2024 nr 99'],
    malNummerLista: ['B 1-24'],
    sammanfattning: 'Fråga bl.a. om lojalitetsplikt. Talan ogillades.',
    innehall: paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join(''),
    ...overrides,
  });
}

function outline(sections: RulingSection[]) {
  return sections.map((section) => [
    section.heading,
    section.subsections.map((subsection) => subsection.heading),
  ]);
}

describe('parseRulingRecord on a recent AD ruling with an attachment (AD 2024 nr 13)', () => {
  const ruling = parseRulingRecord(fixture('ruling-ad-2024-nr-13.json'));

  it('reads court, identifier, case numbers, date and title', () => {
    expect(ruling).toMatchObject({
      identifier: 'AD 2024 nr 13',
      court: 'AD',
      date: '2024-02-14',
      title: 'En arbetstagares anställning på ett s.k. HVB-hem har upphört.',
      warnings: [],
    });
    expect(ruling.structure).toMatchObject({
      kind: 'ruling',
      court: 'AD',
      references: ['AD 2024 nr 13'],
      caseNumbers: ['B 116-22'],
      summary: expect.stringMatching(/^En arbetstagares anställning/),
    });
  });

  it('finds the main sections in order and the sub-sections under Domskäl', () => {
    expect(outline(ruling.structure.sections)).toEqual([
      ['Inledning', []],
      ['Bakgrund', []],
      ['Yrkanden och inställning', []],
      ['Grunder och omständigheter', []],
      ['Utredningen', []],
      [
        'Domskäl',
        [
          'Tvisten',
          'Rättsliga utgångspunkter',
          'Informationen är i detta fall inte företagshemligheter',
          'Rättegångskostnader',
          'Sekretess',
        ],
      ],
      ['Domslut', []],
    ]);
  });

  it('keeps the party lines in Inledning', () => {
    expect(ruling.structure.sections[0]!.paragraphs.slice(0, 4)).toEqual([
      'Nr 13',
      'A.N.',
      'mot',
      'Gnistan HVB Aktiebolag.',
    ]);
  });

  it("leaves out the district court's judgment after BILAGA and the clerk's line", () => {
    expect(ruling.text).not.toMatch(/BILAGA|Rättssekreterare/);
    expect(ruling.structure.sections.at(-1)!.paragraphs.at(-1)).toBe(
      '4. Tingsrättens beslut om sekretess ska inte längre gälla.',
    );
  });
});

describe('parseRulingRecord on an older AD ruling with upper-case headings (AD 1994 nr 79)', () => {
  const ruling = parseRulingRecord(fixture('ruling-ad-1994-nr-79.json'));
  const sections = ruling.structure.sections;

  it('normalises upper-case headings and records the role of each section', () => {
    expect(sections.map((section) => [section.heading, section.role])).toEqual([
      ['Inledning', 'opening'],
      ['Bakgrund', 'proceedings'],
      ['Parternas talan', 'proceedings'],
      ['Domskäl', 'reasons'],
      ['Domslut', 'ruling'],
      ['Skiljaktig mening', 'dissent'],
    ]);
  });

  it('keeps sub-sections such as Tystnadsplikt under Domskäl with their paragraphs', () => {
    const reasons = sections.find((section) => section.heading === 'Domskäl')!;
    const confidentiality = reasons.subsections.find((sub) => sub.heading === 'Tystnadsplikt')!;

    expect(reasons.subsections.map((sub) => sub.heading)).toContain('Lojalitetskravet');
    expect(confidentiality.paragraphs[0]).toMatch(/^När det gäller den tystnadsplikt som/);
  });

  it('puts the dissent in its own section', () => {
    expect(sections.at(-1)!.paragraphs[0]).toBe('Ledamoten Inge Janerus skiljaktiga mening');
  });
});

describe('parseRulingRecord on an NJA report with three instances (NJA 2015 s. 741)', () => {
  const ruling = parseRulingRecord(fixture('ruling-nja-2015-s-741.json'));

  it('uses the NJA page reference as identifier and keeps the other references', () => {
    expect(ruling).toMatchObject({
      identifier: 'NJA 2015 s. 741',
      court: 'HD',
      title: 'Partneravtalet',
    });
    expect(ruling.structure.references).toEqual(['NJA 2015 s. 741', 'NJA 2015:69']);
    expect(ruling.structure.caseNumbers).toEqual(['T 980-14']);
  });

  it("starts at HD's own decision", () => {
    expect(ruling.structure.sections[0]!.paragraphs).toEqual([
      'HD (justitieråden Ella Nyström, Kerstin Calissendorff och Anders Eka) meddelade den 6 november 2015 följande dom.',
    ]);
    expect(outline(ruling.structure.sections).map(([heading]) => heading)).toEqual([
      'Inledning',
      'Domskäl',
      'Domslut',
      'Skiljaktig mening',
    ]);
  });

  it('excludes the district court, the appeal court and the clerk’s proposal', () => {
    expect(ruling.text).not.toMatch(
      /Varbergs tingsrätt|Hovrätten för Västra Sverige|Föredraganden/,
    );
    expect(ruling.text).not.toContain('HD:s dom meddelad');
  });
});

describe('parseRulingRecord on edge cases', () => {
  it('reads headings written inside the paragraph in old NJA reports', () => {
    const ruling = parseRulingRecord(
      record(
        [
          'TR:n anförde: Domskäl. Tingsrättens skäl.',
          'HD (JustR:n Holmberg och Lind) beslöt följande dom: Domskäl. Högsta domstolens skäl.',
          'Domslut. HD fastställer TR:ns domslut.',
          'JustR Lind tillade följande: Ett tillägg.',
        ],
        { domstol: { domstolKod: 'HDO' }, referatNummerLista: ['NJA 1984 s. 665', 'NJA 1984:118'] },
      ),
    );

    expect(ruling.structure.sections).toEqual([
      {
        heading: 'Inledning',
        role: 'opening',
        paragraphs: ['HD (JustR:n Holmberg och Lind) beslöt följande dom:'],
        subsections: [],
      },
      {
        heading: 'Domskäl',
        role: 'reasons',
        paragraphs: ['Högsta domstolens skäl.'],
        subsections: [],
      },
      {
        heading: 'Domslut',
        role: 'ruling',
        paragraphs: ['HD fastställer TR:ns domslut.'],
        subsections: [],
      },
      {
        heading: 'Tillägg',
        role: 'addition',
        paragraphs: ['JustR Lind tillade följande: Ett tillägg.'],
        subsections: [],
      },
    ]);
  });

  it('flags an NJA report without the start of HD’s decision and keeps the whole text', () => {
    const ruling = parseRulingRecord(
      record(['Domskäl', 'Skälen.', 'Domslut', 'Utgången.'], { domstol: { domstolKod: 'HDO' } }),
    );

    expect(ruling.warnings).toEqual(["No start of HD's decision found; the whole text is used"]);
    expect(ruling.structure.sections.map((section) => section.heading)).toEqual([
      'Domskäl',
      'Domslut',
    ]);
  });

  it('imports a ruling without recognised sections as one flagged section', () => {
    const ruling = parseRulingRecord(
      record(['Nr 99', 'A mot B.', 'Arbetsdomstolen avskriver målet.']),
    );

    expect(ruling.warnings).toEqual([
      'No Domskäl or Domslut heading found; imported as one section',
    ]);
    expect(ruling.structure.sections).toEqual([
      {
        heading: WHOLE_RULING_HEADING,
        role: 'whole',
        paragraphs: ['Nr 99', 'A mot B.', 'Arbetsdomstolen avskriver målet.'],
        subsections: [],
      },
    ]);
  });

  it('treats a statement with a colon as text, not as a heading', () => {
    const ruling = parseRulingRecord(
      record([
        'Nr 99',
        'A',
        'mot',
        'B',
        'Överklagade domen: Kalmar tingsrätts dom',
        'Domskäl',
        'Skälen.',
      ]),
    );

    expect(ruling.structure.sections[0]).toMatchObject({
      heading: 'Inledning',
      paragraphs: ['Nr 99', 'A', 'mot', 'B', 'Överklagade domen: Kalmar tingsrätts dom'],
      subsections: [],
    });
  });

  it('keeps headings that repeat for each party as sub-sections', () => {
    const ruling = parseRulingRecord(
      record([
        'Nr 99',
        'A',
        'mot',
        'B',
        'Frisörföretagarna',
        'Bakgrund',
        'Förbundets bakgrund.',
        'Arbetstagarparterna',
        'Bakgrund',
        'Arbetstagarnas bakgrund.',
        'Domskäl',
        'Skälen.',
      ]),
    );

    expect(outline(ruling.structure.sections)).toEqual([
      ['Inledning', ['Frisörföretagarna', 'Bakgrund', 'Arbetstagarparterna', 'Bakgrund']],
      ['Domskäl', []],
    ]);
  });

  it('keeps short acronyms and numerals in capitals', () => {
    const ruling = parseRulingRecord(
      record(['Nr 99', 'DO', 'mot', 'B', 'Yrkanden', 'DO', 'DO:s yrkanden.', 'DOMSKÄL', 'Skälen.']),
    );

    expect(outline(ruling.structure.sections)).toEqual([
      ['Inledning', []],
      ['Yrkanden', ['DO']],
      ['Domskäl', []],
    ]);
  });

  it('treats a line that introduces a list as text, but keeps Domslut before a numbered list', () => {
    const ruling = parseRulingRecord(
      record([
        'Domskäl',
        'Förbundet har yrkat att Arbetsdomstolen ska',
        'a) förklara avskedandet ogiltigt,',
        'Parterna är oeniga i frågorna',
        '- om informationen var hemlig.',
        'Domslut',
        '1. Arbetsdomstolen avslår talan.',
      ]),
    );

    expect(ruling.structure.sections).toEqual([
      {
        heading: 'Domskäl',
        role: 'reasons',
        paragraphs: [
          'Förbundet har yrkat att Arbetsdomstolen ska',
          'a) förklara avskedandet ogiltigt,',
          'Parterna är oeniga i frågorna',
          '- om informationen var hemlig.',
        ],
        subsections: [],
      },
      {
        heading: 'Domslut',
        role: 'ruling',
        paragraphs: ['1. Arbetsdomstolen avslår talan.'],
        subsections: [],
      },
    ]);
  });

  it('keeps the party blocks of joined cases in Inledning', () => {
    const ruling = parseRulingRecord(
      record([
        'Nr 99',
        'II',
        'Bolaget AB',
        'mot',
        'A',
        'III',
        'Bolaget AB',
        'mot',
        'B',
        'Domskäl',
        'Skälen.',
      ]),
    );

    expect(ruling.structure.sections[0]).toEqual({
      heading: 'Inledning',
      role: 'opening',
      paragraphs: ['Nr 99', 'II', 'Bolaget AB', 'mot', 'A', 'III', 'Bolaget AB', 'mot', 'B'],
      subsections: [],
    });
  });

  it('joins a heading the source splits over two paragraphs', () => {
    const ruling = parseRulingRecord(
      record(['Domskäl', 'Tvisten', 'Text.', 'Var informationen hemlig hos', 'C-Rad?', 'Ja.']),
    );

    expect(outline(ruling.structure.sections)).toEqual([
      ['Domskäl', ['Tvisten', 'Var informationen hemlig hos C-Rad?']],
    ]);
  });

  it('treats a judge who is skiljaktig and adds something as a dissent', () => {
    const ruling = parseRulingRecord(
      record(
        [
          'HD (JustR:n A, B och C) beslöt följande dom: Domskäl. Skälen.',
          'Domslut. Talan ogillas.',
          'JustR:n A och B voro skiljaktiga och tillade: Annan mening.',
        ],
        { domstol: { domstolKod: 'HDO' }, referatNummerLista: ['NJA 1980 s. 1'] },
      ),
    );

    expect(ruling.structure.sections.at(-1)).toMatchObject({
      heading: 'Skiljaktig mening',
      role: 'dissent',
    });
  });

  it('reads paragraphs in upper-case tags and rejects a text without paragraphs', () => {
    const upper = record([], { innehall: '<P>Domskäl</P><P>Skälen.</P>' });

    expect(parseRulingRecord(upper).structure.sections[0]!.heading).toBe('Domskäl');
    expect(() => parseRulingRecord(record([], { innehall: '<div>Bara text</div>' }))).toThrow(
      'No paragraphs in the full text',
    );
  });

  it('does not end the title sentence at an abbreviation', () => {
    expect(parseRulingRecord(record(['Domskäl', 'Skälen.'])).title).toBe(
      'Fråga bl.a. om lojalitetsplikt.',
    );
  });

  it.each([
    ['invalid JSON', '{', 'not JSON'],
    [
      'an unsupported court',
      record(['Domskäl'], { domstol: { domstolKod: 'HFD' } }),
      'Unsupported court HFD',
    ],
    ['no reference number', record(['Domskäl'], { referatNummerLista: [] }), 'No reference number'],
    ['no decision date', record(['Domskäl'], { avgorandedatum: null }), 'No decision date'],
    ['no full text', record([], { innehall: '' }), 'No HTML full text'],
  ])('rejects a record with %s', (_, json, message) => {
    expect(() => parseRulingRecord(json)).toThrow(RulingParseError);
    expect(() => parseRulingRecord(json)).toThrow(message);
  });
});
