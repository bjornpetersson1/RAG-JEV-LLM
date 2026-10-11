import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Chunk } from '../llm/types.js';
import { TEMPLATES, type Template } from '../tagging/vocabulary.js';
import {
  findCitations,
  loadPromptTemplate,
  parsePromptTemplate,
  PROMPTS_DIR,
  renderPromptTemplate,
  type PromptTemplate,
} from './templates.js';

const REQUIRED_SECTIONS: Record<Template, readonly string[]> = {
  employment: [
    'Parter',
    'Anställningsform',
    'Provanställning',
    'Arbetsuppgifter',
    'Lön',
    'Arbetstid',
    'Semester',
    'Uppsägning',
    'Konkurrensklausul',
    'Sekretess',
  ],
  nda: [
    'Parter',
    'Definition av konfidentiell information',
    'Undantag',
    'Användning',
    'Giltighetstid',
    'Vite/skadestånd',
    'Tillämplig lag och tvist',
  ],
};

const CHUNKS: Chunk[] = [
  { id: '12', text: 'Ett avtal om tidsbegränsad anställning ...', source: 'SFS 1982:80 5 §' },
  {
    id: '40',
    text: 'Domskäl om konkurrensklausulens skälighet ...',
    source: 'AD 2010 nr 27, Domskäl',
  },
  { id: '77', text: 'Text utan källhänvisning.' },
];

const INSTRUCTION = 'Anställningsavtal för en säljare med provanställning i sex månader.';

function render(id: Template, parties?: string) {
  const template = loadPromptTemplate(id);
  return {
    template,
    ...renderPromptTemplate(template, { instruction: INSTRUCTION, chunks: CHUNKS, parties }),
  };
}

describe.each(TEMPLATES)('the committed %s template', (id) => {
  it('has a prompt file', () => {
    expect(existsSync(join(PROMPTS_DIR, `${id}.md`))).toBe(true);
  });

  it('asks for a Markdown heading for every required section', () => {
    const { system } = render(id);
    expect(system).toMatch(/Markdown/);
    expect(system).toMatch(/rubrik \(`##`\)/);
    for (const section of REQUIRED_SECTIONS[id]) {
      expect(system).toMatch(new RegExp(`^\\d+\\. ${escape(section)}$`, 'm'));
    }
  });

  it('inserts the fictional default parties when none are given', () => {
    const { template, prompt } = render(id);
    expect(template.defaultParties).not.toBe('');
    expect(prompt).toContain(template.defaultParties);
  });

  it('uses the given parties instead of the defaults', () => {
    const { template, prompt } = render(id, 'Arbetsgivare: Testbolaget AB');
    expect(prompt).toContain('Arbetsgivare: Testbolaget AB');
    expect(prompt).not.toContain(template.defaultParties);
  });

  it('instructs the model to cite with [K:<id>] and only supplied ids', () => {
    const { system } = render(id);
    expect(system).toContain('`[K:<id>]`');
    expect(system).toMatch(/Hänvisa bara till id:n som finns i underlaget/);
  });

  it('lists every chunk with its citation id and source reference', () => {
    const { prompt } = render(id);
    expect(prompt).toContain('[K:12] SFS 1982:80 5 §\nEtt avtal om tidsbegränsad anställning ...');
    expect(prompt).toContain('[K:40] AD 2010 nr 27, Domskäl\nDomskäl om konkurrensklausulens');
    expect(prompt).toContain('[K:77]\nText utan källhänvisning.');
    expect(prompt.indexOf('[K:12]')).toBeLessThan(prompt.indexOf('[K:40]'));
  });

  it('fills every slot', () => {
    const { system, prompt } = render(id);
    expect(prompt).toContain(INSTRUCTION);
    expect(system).not.toContain('{{');
    expect(prompt).not.toContain('{{');
  });

  it('contains the disclaimer line and the placeholder rule', () => {
    const { template, system } = render(id);
    expect(template.disclaimer).toMatch(/inte juridisk rådgivning/);
    expect(system).toContain(template.disclaimer);
    expect(system).toMatch(/platshållare inom hakparentes/);
    expect(system).toMatch(/Platshållare börjar aldrig med `K:`/);
  });
});

describe('renderPromptTemplate', () => {
  it('does not fill slot-like text inside the instruction', () => {
    const template = loadPromptTemplate('nda');
    const { prompt } = renderPromptTemplate(template, {
      instruction: 'Behåll texten {{chunks}} ordagrant.',
      chunks: CHUNKS,
    });
    expect(prompt).toContain('Behåll texten {{chunks}} ordagrant.');
  });

  it('requires at least one chunk', () => {
    const template = loadPromptTemplate('employment');
    expect(() => renderPromptTemplate(template, { instruction: INSTRUCTION, chunks: [] })).toThrow(
      'A draft needs at least one chunk',
    );
  });

  it('writes chunk citations that findCitations reads back', () => {
    const template = loadPromptTemplate('employment');
    const { prompt } = renderPromptTemplate(template, { instruction: INSTRUCTION, chunks: CHUNKS });
    const ids = findCitations(prompt).map(({ id }) => id);
    expect(ids).toEqual(['12', '40', '77']);
  });
});

describe('loadPromptTemplate', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads each template file once', () => {
    expect(loadPromptTemplate('nda')).toBe(loadPromptTemplate('nda'));
  });

  it('names the id and the available templates for an unknown id', () => {
    expect(() => loadPromptTemplate('lease')).toThrow(
      'Unknown template "lease": expected one of employment, nda',
    );
  });

  it('names the file when a part or slot is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'prompts-'));
    const path = join(dir, 'nda.md');
    writeFileSync(path, '## System\n\n{{disclaimer}}\n\n## Användare\n\n{{instruction}}\n');
    expect(() => loadPromptTemplate('nda', dir)).toThrow(
      [
        `Invalid prompt template ${path}:`,
        '- "## Användare" has no {{parties}} slot',
        '- "## Användare" has no {{chunks}} slot',
        '- missing the "## Standardparter" part',
        '- missing the "## Friskrivning" part',
      ].join('\n'),
    );
  });
});

describe('parsePromptTemplate', () => {
  const VALID_PARTS = [
    '## System\n{{disclaimer}}',
    '## Användare\n{{instruction}} {{parties}} {{chunks}}',
    '## Standardparter\nA och B',
    '## Friskrivning\nInte rådgivning.',
  ];

  it('rejects an unknown or repeated part, which would cut another part short', () => {
    const text = [...VALID_PARTS, '## Exempel\nText', '## System\nIgen {{disclaimer}}'].join('\n');
    expect(() => parsePromptTemplate(text, 'x.md')).toThrow(
      'Invalid prompt template x.md:\n- unknown part "## Exempel"\n- "## System" appears more than once',
    );
  });

  it('reports an empty part as empty', () => {
    const text = [...VALID_PARTS.slice(0, 3), '## Friskrivning\n'].join('\n');
    expect(() => parsePromptTemplate(text, 'x.md')).toThrow('"## Friskrivning" is empty');
  });

  it('reports a slot written with spaces as unknown', () => {
    const text = [
      VALID_PARTS[0],
      '## Användare\n{{ instruction }} {{parties}} {{chunks}}',
      ...VALID_PARTS.slice(2),
    ].join('\n');
    expect(() => parsePromptTemplate(text, 'x.md')).toThrow(
      '"## Användare" has an unknown slot {{ instruction }}',
    );
  });

  it('rejects an unknown slot', () => {
    const text = [
      '## System\n{{disclaimer}} {{tone}}',
      '## Användare\n{{instruction}} {{parties}} {{chunks}}',
      '## Standardparter\nA och B',
      '## Friskrivning\nInte rådgivning.',
    ].join('\n');
    expect(() => parsePromptTemplate(text, 'x.md')).toThrow(
      '"## System" has an unknown slot {{tone}}',
    );
  });

  it('splits the parts by their headings', () => {
    const text = [
      '# Titel',
      '## System\nRoll. {{disclaimer}}',
      '## Användare\n{{instruction}}\n{{parties}}\n{{chunks}}',
      '## Standardparter\nA och B',
      '## Friskrivning\nInte rådgivning.',
    ].join('\n');
    const parts: Omit<PromptTemplate, 'id'> = parsePromptTemplate(text, 'x.md');
    expect(parts).toEqual({
      system: 'Roll. {{disclaimer}}',
      user: '{{instruction}}\n{{parties}}\n{{chunks}}',
      defaultParties: 'A och B',
      disclaimer: 'Inte rådgivning.',
    });
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

describe('findCitations', () => {
  it('finds single citations with the offsets of their brackets', () => {
    const text = 'Lön betalas månadsvis [K:12]. Semester [K:40][K:7].';
    expect(findCitations(text)).toEqual([
      { id: '12', start: 22, end: 28 },
      { id: '40', start: 39, end: 45 },
      { id: '7', start: 45, end: 50 },
    ]);
    expect(text.slice(22, 28)).toBe('[K:12]');
  });

  it('returns one entry per id in a bracket group', () => {
    expect(findCitations('Se [K:12, K:40] och [K:3,4].')).toEqual([
      { id: '12', start: 3, end: 15 },
      { id: '40', start: 3, end: 15 },
      { id: '3', start: 20, end: 27 },
      { id: '4', start: 20, end: 27 },
    ]);
  });

  it('does not read an unclosed [K: across lines', () => {
    expect(findCitations('Se [K:1\n\nText [K:2].').map(({ id }) => id)).toEqual(['2']);
  });

  it('ignores placeholders and text without citations', () => {
    expect(findCitations('Lön: [lön], start [tillträdesdag].')).toEqual([]);
  });

  it('can be called repeatedly with the same result', () => {
    expect(findCitations('[K:1]')).toEqual(findCitations('[K:1]'));
  });
});
