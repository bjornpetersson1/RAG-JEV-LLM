import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LawParseError, parseLawPage } from './parse-law.js';

const TODAY = '2026-10-10';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** A minimal SFST page around `body`, with the header fields the parser reads. */
function page(body: string, header = '<span class="bold">Utfärdad:</span> 2000-01-01'): string {
  return `<div>SFS-nummer · 2000:1</div>
<span class="bold">Lag (2000:1) om provning</span>
${header}
<div class="result-box-text body-text">${body}</div>`;
}

describe('parseLawPage on a law without chapters (2018:558)', () => {
  const law = parseLawPage(fixture('law-sfs-2018-558.html'), TODAY);
  const [chapter] = law.structure.chapters;

  it('reads the header fields', () => {
    expect(law).toMatchObject({
      title: 'Lag (2018:558) om företagshemligheter',
      sfsNumber: '2018:558',
      issuedOn: '2018-05-25',
      consolidatedThrough: '2025:1281',
    });
  });

  it('puts every section in one chapter without number or title', () => {
    expect(law.structure.chapters).toHaveLength(1);
    expect(chapter).toMatchObject({ number: null, title: null });
    expect(chapter!.sections.map((section) => section.number)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps headings, paragraphs and list items', () => {
    expect(chapter!.sections[1]).toEqual({
      number: '2',
      heading: 'Vad som avses med företagshemlighet',
      paragraphs: [
        'Med företagshemlighet avses i denna lag information\n' +
          '1. om affärs- eller driftförhållanden i en näringsidkares rörelse eller i en forskningsinstitutions verksamhet,\n' +
          '2. som varken som helhet eller i den form dess beståndsdelar ordnats och satts samman är allmänt känd hos eller lättillgänglig för den som normalt har tillgång till information av det aktuella slaget,\n' +
          '3. som innehavaren har vidtagit rimliga åtgärder för att hemlighålla, och\n' +
          '4. vars röjande är ägnat att medföra skada i konkurrenshänseende för innehavaren.',
        'Erfarenheter och färdigheter som en arbetstagare har fått vid normal yrkesutövning är inte en företagshemlighet. Inte heller är information om något som utgör ett brott eller annat allvarligt missförhållande en företagshemlighet.',
      ],
      amendedBy: null,
    });
  });

  it('reads the transitional provisions', () => {
    expect(law.structure.transitional).toEqual([
      {
        sfs: '2018:558',
        paragraphs: [expect.stringMatching(/^1\. Denna lag träder i kraft den 1 juli 2018\.\n2\./)],
      },
    ]);
  });

  it('joins hard line breaks in the stored text', () => {
    expect(law.text).toContain(
      '1 § Lagen innehåller bestämmelser om skadestånd, vitesförbud och straff vid obehöriga angrepp på företagshemligheter.',
    );
  });
});

describe('parseLawPage on a law with chapters (2008:567)', () => {
  const law = parseLawPage(fixture('law-sfs-2008-567.html'), TODAY);
  const chapters = law.structure.chapters;

  it('reads chapters with their numbers and titles', () => {
    expect(chapters.map((chapter) => [chapter.number, chapter.title])).toEqual([
      ['1', 'Inledande bestämmelser'],
      ['2', 'Förbud mot diskriminering och repressalier'],
      ['3', 'Aktiva åtgärder'],
    ]);
    expect(chapters.map((chapter) => chapter.sections.map((section) => section.number))).toEqual([
      ['1', '2', '3', '4'],
      ['1', '2', '3', '4', '5', '6'],
      ['1'],
    ]);
  });

  it('moves the amendment note out of the text', () => {
    const section = chapters[0]!.sections[0]!;

    expect(section.amendedBy).toBe('2014:958');
    expect(section.paragraphs).toEqual([
      'Denna lag har till ändamål att motverka diskriminering och på andra sätt främja lika rättigheter och möjligheter oavsett kön, könsöverskridande identitet eller uttryck, etnisk tillhörighet, religion eller annan trosuppfattning, funktionsnedsättning, sexuell läggning eller ålder.',
    ]);
  });

  it('keeps the nearest heading for sections without their own', () => {
    expect(chapters[1]!.sections.map((section) => section.heading)).toEqual([
      'Diskrimineringsförbud',
      'Diskrimineringsförbud',
      'Skyldighet att utreda och vidta åtgärder mot trakasserier',
      'Uppgift om meriter',
      'Diskrimineringsförbud',
      'Diskrimineringsförbud',
    ]);
  });

  it('does not start a chapter at "25 kap." inside running text', () => {
    const section = chapters[1]!.sections.find((candidate) => candidate.number === '6')!;

    expect(section.paragraphs[0]).toContain(
      'som avses i 25 kap. skollagen, eller\n3. särbehandling',
    );
  });

  it('keeps only the version of a section that is in force', () => {
    const section = chapters[1]!.sections.find((candidate) => candidate.number === '6')!;

    expect(chapters[1]!.sections.filter((candidate) => candidate.number === '6')).toHaveLength(1);
    expect(section.paragraphs[0]).toContain('anpassade grundskolan');
    expect(law.notInForce).toEqual(['2 kap. 6 §']);
  });

  it('switches to the new version once its date has passed', () => {
    const later = parseLawPage(fixture('law-sfs-2008-567.html'), '2028-07-01');
    const section = later.structure.chapters[1]!.sections.find(
      (candidate) => candidate.number === '6',
    )!;

    expect(later.notInForce).toEqual(['2 kap. 6 §']);
    expect(section.paragraphs[0]).not.toEqual(
      law.structure.chapters[1]!.sections.find((candidate) => candidate.number === '6')!
        .paragraphs[0],
    );
  });

  it('stores only the text in force, without markers or amendment notes', () => {
    expect(law.text).not.toMatch(/Upphör att gälla|Träder i kraft|Lag \(2014:958\)/);
    expect(law.text.match(/^6 § /gm)).toHaveLength(1);
    expect(law.text).toMatch(/^1 kap\. Inledande bestämmelser\n\nLagens ändamål\n\n1 § Denna lag/);
    expect(law.text).toContain('\n\nÖvergångsbestämmelser\n\n2008:567\n\n');
  });

  it('reads one transitional entry per amending act', () => {
    expect(law.structure.transitional.map((entry) => entry.sfs)).toEqual(['2008:567', '2014:958']);
  });
});

describe('parseLawPage on edge cases', () => {
  it('leaves out repealed sections and accepts a new section reusing the number', () => {
    const law = parseLawPage(
      page(`1 § Första.

2 § Har upphävts genom lag (2015:760).

2 § Ny andra.

3 § Har upphävts genom lag (2001:1).`),
      TODAY,
    );

    expect(law.structure.chapters[0]!.sections.map((section) => section.paragraphs)).toEqual([
      ['Första.'],
      ['Ny andra.'],
    ]);
    expect(law.repealed).toEqual(['2 §', '3 §']);
  });

  it('does not start a section at a block that refers back to an earlier section', () => {
    const law = parseLawPage(
      page(`1 § Första.

2 § Andra.

1 § första stycket gäller inte arbetstagare i hushåll.`),
      TODAY,
    );

    expect(law.structure.chapters[0]!.sections.map((section) => section.paragraphs)).toEqual([
      ['Första.'],
      ['Andra.', '1 § första stycket gäller inte arbetstagare i hushåll.'],
    ]);
  });

  it('takes headings ending in an abbreviation, also when one heading follows another', () => {
    const law = parseLawPage(
      page(`Påföljder

Ogiltighet m.m.

1 § Första.

Straffbestämmelser m. m.

2 § Andra.`),
      TODAY,
    );

    expect(
      law.structure.chapters[0]!.sections.map((section) => [section.heading, section.paragraphs]),
    ).toEqual([
      ['Ogiltighet m.m.', ['Första.']],
      ['Straffbestämmelser m. m.', ['Andra.']],
    ]);
  });

  it('takes a heading right before a chapter', () => {
    const law = parseLawPage(
      page(`1 kap. Inledning

1 § Första.

Särskilda bestämmelser

2 kap. Ersättning

1 § Andra.`),
      TODAY,
    );

    expect(law.structure.chapters.map((chapter) => chapter.sections[0]!.paragraphs)).toEqual([
      ['Första.'],
      ['Andra.'],
    ]);
  });

  it('keeps letter list items in the paragraph that introduces them', () => {
    const law = parseLawPage(
      page(`1 § Beslut får överklagas i fråga om

a. tillträde till utbildning,

b. tillgodoräknande av kurs.

Andra stycket.`),
      TODAY,
    );

    expect(law.structure.chapters[0]!.sections[0]!.paragraphs).toEqual([
      'Beslut får överklagas i fråga om\na. tillträde till utbildning,\nb. tillgodoräknande av kurs.',
      'Andra stycket.',
    ]);
  });

  it('moves an amendment note without a final full stop', () => {
    const law = parseLawPage(page('1 § Första. Lag (2022:836)'), TODAY);

    expect(law.structure.chapters[0]!.sections[0]).toMatchObject({
      paragraphs: ['Första.'],
      amendedBy: '2022:836',
    });
  });

  it('does not start a section at running text that refers to a later section', () => {
    const law = parseLawPage(
      page(`5 § Femte.

7 § första stycket gäller inte arbetstagare i hushåll.

6 § Sjätte.`),
      TODAY,
    );

    expect(law.structure.chapters[0]!.sections.map((section) => section.number)).toEqual([
      '5',
      '6',
    ]);
    expect(law.structure.chapters[0]!.sections[0]!.paragraphs).toEqual([
      'Femte.',
      '7 § första stycket gäller inte arbetstagare i hushåll.',
    ]);
  });

  it('returns null for a law without "Ändring införd"', () => {
    expect(parseLawPage(page('1 § Första.'), TODAY).consolidatedThrough).toBeNull();
  });

  it.each([
    ['no title', '<div class="result-box-text body-text">1 § x</div>', 'No law title'],
    ['no "Utfärdad" date', page('1 § Första.', ''), 'No "Utfärdad" date'],
    ['no sections', page('Bara text utan paragrafer.'), 'Text outside any section'],
    [
      'no law text',
      '<span class="bold">Lag (2000:1) om x</span> SFS-nummer · 2000:1 <span class="bold">Utfärdad:</span> 2000-01-01',
      'No law text',
    ],
  ])('rejects a page with %s', (_, html, message) => {
    expect(() => parseLawPage(html, TODAY)).toThrow(LawParseError);
    expect(() => parseLawPage(html, TODAY)).toThrow(message);
  });
});
