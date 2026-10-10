import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkDocument, estimateTokens, type ChunkableDocument } from './chunk.js';
import { DEFAULT_CHUNK_CONFIG, type ChunkConfig } from './chunk-config.js';
import { parseLawPage } from './parse-law.js';
import { parseRulingRecord } from './parse-ruling.js';
import type { RulingStructure } from './structure.js';

const SMALL: ChunkConfig = { maxChars: 300, minChars: 100 };
const CONFIGS: [string, ChunkConfig][] = [
  ['the default', DEFAULT_CHUNK_CONFIG],
  ['CHUNK_MAX_CHARS=300', SMALL],
];

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function law(name: string, identifier: string): ChunkableDocument {
  const parsed = parseLawPage(fixture(name), '2026-10-10');
  return { identifier, title: parsed.title, structure: parsed.structure };
}

function ruling(name: string): ChunkableDocument {
  const parsed = parseRulingRecord(fixture(name));
  return { identifier: parsed.identifier, title: parsed.title, structure: parsed.structure };
}

const WITHOUT_CHAPTERS = law('law-sfs-2018-558.html', 'SFS 2018:558');
const WITH_CHAPTERS = law('law-sfs-2008-567.html', 'SFS 2008:567');
const RULING = ruling('ruling-ad-1994-nr-79.json');

/** Every text the document holds, in order, to compare with the chunks up to whitespace. */
function sourceText(document: ChunkableDocument): string {
  const { structure } = document;
  if (structure.kind === 'law') {
    return [
      ...structure.chapters.flatMap((chapter) =>
        chapter.sections.flatMap((section) => [`${section.number} §`, ...section.paragraphs]),
      ),
      ...structure.transitional.flatMap((entry) => entry.paragraphs),
    ].join(' ');
  }
  return structure.sections
    .flatMap((section) => [
      ...section.paragraphs,
      ...section.subsections.flatMap((subsection) => [
        subsection.heading,
        ...subsection.paragraphs,
      ]),
    ])
    .join(' ');
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).join(' ');

describe('chunkDocument on a law without chapters (2018:558)', () => {
  const chunks = chunkDocument(WITHOUT_CHAPTERS, DEFAULT_CHUNK_CONFIG);

  it('makes one chunk per section and transitional entry', () => {
    expect(chunks.map((chunk) => chunk.sourceRef)).toEqual([
      'SFS 2018:558 1 §',
      'SFS 2018:558 2 §',
      'SFS 2018:558 3 §',
      'SFS 2018:558 4 §',
      'SFS 2018:558 övergångsbestämmelser 2018:558',
    ]);
  });

  it('starts each section with its number and gives the heading path as context', () => {
    expect(chunks[1]).toMatchObject({
      context: 'Lag (2018:558) om företagshemligheter › Vad som avses med företagshemlighet › 2 §',
      text: expect.stringMatching(
        /^2 § Med företagshemlighet avses i denna lag information\n1\. om/,
      ),
    });
    expect(chunks[1]!.text).toContain(
      '\n\nErfarenheter och färdigheter som en arbetstagare har fått',
    );
    expect(chunks[4]!.context).toBe(
      'Lag (2018:558) om företagshemligheter › Övergångsbestämmelser › 2018:558',
    );
  });
});

describe('chunkDocument on a law with chapters (2008:567)', () => {
  it('cites chapter and section, and the chapter in the context', () => {
    const chunks = chunkDocument(WITH_CHAPTERS, DEFAULT_CHUNK_CONFIG);

    expect(chunks.map((chunk) => chunk.sourceRef)).toEqual([
      'SFS 2008:567 1 kap. 1 §',
      'SFS 2008:567 1 kap. 2 §',
      'SFS 2008:567 1 kap. 3 §',
      'SFS 2008:567 1 kap. 4 § st. 1, del 1/2',
      'SFS 2008:567 1 kap. 4 § st. 1, del 2/2',
      'SFS 2008:567 2 kap. 1 §',
      'SFS 2008:567 2 kap. 2 §',
      'SFS 2008:567 2 kap. 3 §',
      'SFS 2008:567 2 kap. 4 §',
      'SFS 2008:567 2 kap. 5 §',
      'SFS 2008:567 2 kap. 6 §',
      'SFS 2008:567 3 kap. 1 §',
      'SFS 2008:567 övergångsbestämmelser 2008:567',
      'SFS 2008:567 övergångsbestämmelser 2014:958',
    ]);
    expect(chunks[5]!.context).toBe(
      'Diskrimineringslag (2008:567) › 2 kap. Förbud mot diskriminering och repressalier › Diskrimineringsförbud › 1 §',
    );
  });

  it('cites the paragraphs of a split section', () => {
    const chunks = chunkDocument(WITH_CHAPTERS, SMALL);

    expect(chunks.map((chunk) => chunk.sourceRef)).toEqual(
      expect.arrayContaining([
        'SFS 2008:567 2 kap. 1 § st. 1',
        'SFS 2008:567 2 kap. 1 § st. 2–3',
        'SFS 2008:567 2 kap. 6 § st. 2',
        'SFS 2008:567 2 kap. 6 § st. 1, del 1/3',
        'SFS 2008:567 övergångsbestämmelser 2008:567, del 1/7',
      ]),
    );
  });

  it('never puts text from two sections in one chunk', () => {
    const sectionChunks = chunkDocument(WITH_CHAPTERS, SMALL).filter((chunk) =>
      chunk.sourceRef.includes(' kap. '),
    );
    for (const chunk of sectionChunks) {
      const sectionStarts = chunk.text.match(/(?:^|\n\n)\d+(?: [a-z])? § /g) ?? [];
      const cited = /(\d+(?: [a-z])?) §/.exec(chunk.sourceRef)?.[1];

      expect(sectionStarts.length).toBeLessThanOrEqual(1);
      if (sectionStarts[0]) expect(sectionStarts[0].trim()).toBe(`${cited} §`);
    }
  });
});

describe('chunkDocument on a ruling (AD 1994 nr 79)', () => {
  const chunks = chunkDocument(RULING, DEFAULT_CHUNK_CONFIG);
  const refs = chunks.map((chunk) => chunk.sourceRef);

  it('cites main sections and sub-sections', () => {
    expect(refs).toEqual(
      expect.arrayContaining([
        'AD 1994 nr 79, Inledning',
        'AD 1994 nr 79, Bakgrund, del 1/2',
        'AD 1994 nr 79, Domskäl, Tystnadsplikt',
        'AD 1994 nr 79, Domslut',
        'AD 1994 nr 79, Skiljaktig mening',
      ]),
    );
  });

  it('starts a sub-section chunk with its heading and gives the path as context', () => {
    const chunk = chunks.find((candidate) => candidate.sourceRef.endsWith(', Tystnadsplikt'))!;

    expect(chunk.text).toMatch(/^Tystnadsplikt\n\nNär det gäller den tystnadsplikt som/);
    expect(chunk.context).toBe(`AD 1994 nr 79 › ${RULING.title} › Domskäl › Tystnadsplikt`);
  });

  it('merges a short sub-section with the next one', () => {
    expect(refs).toContain(
      'AD 1994 nr 79, Domskäl, Kritikrätten – Utgör K-E.K:s handlande saklig grund för uppsägning?',
    );
  });

  it('numbers a repeated heading', () => {
    expect(refs).toContain('AD 1994 nr 79, Parternas talan, Avslutande synpunkter (2)');
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe('chunk lengths', () => {
  it.each(CONFIGS)('keeps every chunk within the maximum with %s', (_, config) => {
    for (const document of [WITHOUT_CHAPTERS, WITH_CHAPTERS, RULING]) {
      for (const chunk of chunkDocument(document, config)) {
        expect(chunk.text.length).toBeLessThanOrEqual(config.maxChars);
      }
    }
  });

  it.each(CONFIGS)('loses and duplicates no text with %s', (_, config) => {
    for (const document of [WITHOUT_CHAPTERS, WITH_CHAPTERS, RULING]) {
      const chunked = chunkDocument(document, config)
        .map((chunk) => chunk.text)
        .join(' ');
      expect(words(chunked)).toBe(words(sourceText(document)));
    }
  });

  it('splits on paragraphs first, then sentences, then spaces', () => {
    const document: ChunkableDocument = {
      identifier: 'AD 2024 nr 99',
      title: 'Prov',
      structure: {
        kind: 'ruling',
        court: 'AD',
        references: ['AD 2024 nr 99'],
        caseNumbers: [],
        summary: null,
        sections: [
          {
            heading: 'Domskäl',
            role: 'reasons',
            paragraphs: [
              'Första stycket är kort men längre än minimum för testet.',
              'Andra meningen. Tredje meningen som är lite längre. Fjärde.',
              'ettmycketlångtordsomintefårplatsienchunkalls',
            ],
            subsections: [],
          },
        ],
      } satisfies RulingStructure,
    };

    const chunks = chunkDocument(document, { maxChars: 40, minChars: 10 });

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      // The two parts are evened out instead of 36 + 19 characters.
      'Första stycket är kort men',
      'längre än minimum för testet.',
      'Andra meningen.',
      'Tredje meningen som är lite längre.',
      'Fjärde.',
      'ettmycketlångtordsomintefårplatsienchunk',
      'alls',
    ]);
    expect(chunks.map((chunk) => chunk.sourceRef)).toEqual(
      chunks.map((_, index) => `AD 2024 nr 99, Domskäl, del ${index + 1}/7`),
    );
  });

  it('fills a short last piece with paragraphs from the piece before it', () => {
    const document: ChunkableDocument = {
      identifier: 'SFS 2000:1',
      title: 'Lag (2000:1) om prov',
      structure: {
        kind: 'law',
        chapters: [
          {
            number: null,
            title: null,
            sections: [
              {
                number: '1',
                heading: null,
                paragraphs: ['A'.repeat(100), 'B'.repeat(60), 'C'.repeat(90)],
                amendedBy: null,
              },
            ],
          },
        ],
        transitional: [],
      },
    };

    const chunks = chunkDocument(document, { maxChars: 200, minChars: 100 });

    expect(chunks.map((chunk) => chunk.sourceRef)).toEqual([
      'SFS 2000:1 1 § st. 1',
      'SFS 2000:1 1 § st. 2–3',
    ]);
  });

  it('splits a short heading together with the long paragraph after it in a ruling', () => {
    const document: ChunkableDocument = {
      identifier: 'AD 2024 nr 99',
      title: 'Prov',
      structure: {
        kind: 'ruling',
        court: 'AD',
        references: ['AD 2024 nr 99'],
        caseNumbers: [],
        summary: null,
        sections: [
          {
            heading: 'Domskäl',
            role: 'reasons',
            paragraphs: ['Rubrik', 'Första meningen här. Andra meningen här. Tredje meningen.'],
            subsections: [],
          },
        ],
      } satisfies RulingStructure,
    };

    const chunks = chunkDocument(document, { maxChars: 45, minChars: 20 });

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'Rubrik Första meningen här.',
      'Andra meningen här. Tredje meningen.',
    ]);
  });
});

describe('chunkDocument references', () => {
  const rulingWith = (sections: RulingStructure['sections']): ChunkableDocument => ({
    identifier: 'NJA 2010 s. 1',
    title: 'Prov',
    structure: {
      kind: 'ruling',
      court: 'HD',
      references: ['NJA 2010 s. 1'],
      caseNumbers: [],
      summary: null,
      sections,
    },
  });

  it('cites the sub-sections of a repeated main section under its number', () => {
    const document = rulingWith([
      { heading: 'Domskäl', role: 'reasons', paragraphs: ['Första.'], subsections: [] },
      {
        heading: 'Domskäl',
        role: 'reasons',
        paragraphs: ['Andra.'],
        subsections: [{ heading: 'Bakgrund', paragraphs: ['B'.repeat(250)] }],
      },
    ]);

    expect(chunkDocument(document, DEFAULT_CHUNK_CONFIG).map((chunk) => chunk.sourceRef)).toEqual([
      'NJA 2010 s. 1, Domskäl',
      'NJA 2010 s. 1, Domskäl (2)',
      'NJA 2010 s. 1, Domskäl (2), Bakgrund',
    ]);
  });

  it('keeps references unique when a heading looks like a numbered one', () => {
    const document = rulingWith([
      { heading: 'Domskäl', role: 'reasons', paragraphs: ['Första.'], subsections: [] },
      { heading: 'Domskäl (2)', role: 'reasons', paragraphs: ['Andra.'], subsections: [] },
      { heading: 'Domskäl', role: 'reasons', paragraphs: ['Tredje.'], subsections: [] },
    ]);

    const refs = chunkDocument(document, DEFAULT_CHUNK_CONFIG).map((chunk) => chunk.sourceRef);

    expect(new Set(refs).size).toBe(3);
  });

  it('uses the chapter number alone when a chapter has no title', () => {
    const document: ChunkableDocument = {
      identifier: 'SFS 2000:1',
      title: 'Lag (2000:1) om prov',
      structure: {
        kind: 'law',
        chapters: [
          {
            number: '1',
            title: null,
            sections: [{ number: '1', heading: null, paragraphs: ['Text.'], amendedBy: null }],
          },
        ],
        transitional: [],
      },
    };

    expect(chunkDocument(document, DEFAULT_CHUNK_CONFIG)[0]!.context).toBe(
      'Lag (2000:1) om prov › 1 kap. › 1 §',
    );
  });
});

describe('estimateTokens', () => {
  it('counts 3.5 characters per token, rounded up', () => {
    expect(estimateTokens('a'.repeat(7))).toBe(2);
    expect(estimateTokens('a'.repeat(8))).toBe(3);
  });
});
