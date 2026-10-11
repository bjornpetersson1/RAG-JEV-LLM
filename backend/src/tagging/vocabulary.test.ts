import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { VOCABULARY_PATH } from './paths.js';
import {
  AREAS,
  loadVocabulary,
  parseVocabulary,
  TEMPLATES,
  vocabularyVersion,
  type Area,
  type Vocabulary,
  type VocabularyLimits,
  type VocabularyTag,
} from './vocabulary.js';

describe('the committed vocabulary', () => {
  let vocabulary: Vocabulary;

  beforeAll(() => {
    vocabulary = loadVocabulary(VOCABULARY_PATH);
  });

  it('has 100–300 tags with every field filled in', () => {
    expect(vocabulary.tags.length).toBeGreaterThanOrEqual(100);
    expect(vocabulary.tags.length).toBeLessThanOrEqual(300);
    for (const tag of vocabulary.tags) {
      expect(tag.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(tag.label.trim()).not.toBe('');
      expect(tag.description.trim()).not.toBe('');
      expect(Object.keys(AREAS)).toContain(tag.area);
    }
  });

  it('has 5–30 tags in each of the 10 areas', () => {
    expect(Object.keys(AREAS)).toHaveLength(10);
    for (const area of Object.keys(AREAS)) {
      const count = vocabulary.tags.filter((tag) => tag.area === area).length;
      expect(count, area).toBeGreaterThanOrEqual(5);
      expect(count, area).toBeLessThanOrEqual(30);
    }
  });

  it('has presets of 10–25 known tags for both templates', () => {
    const slugs = new Set(vocabulary.tags.map((tag) => tag.slug));
    for (const template of TEMPLATES) {
      const preset = vocabulary.presets[template];
      expect(preset.length, template).toBeGreaterThanOrEqual(10);
      expect(preset.length, template).toBeLessThanOrEqual(25);
      for (const slug of preset) expect(slugs.has(slug), slug).toBe(true);
    }
  });
});

describe('parseVocabulary', () => {
  // Small limits so the fixtures stay small: 2–4 tags in total, 0–2 per area, 1–2 per preset.
  const limits: VocabularyLimits = {
    tags: { min: 2, max: 4 },
    perArea: { min: 0, max: 2 },
    perPreset: { min: 1, max: 2 },
  };

  const tag = (slug: string, area: Area = 'lon'): Record<string, unknown> => ({
    slug,
    label: `Etikett ${slug}`,
    description: `beskrivning av ${slug}`,
    area,
  });

  const validFile = () => ({
    tags: [tag('lon'), tag('bonus'), tag('vite', 'skadestand')],
    presets: { employment: ['lon'], nda: ['vite'] } as Record<string, unknown>,
  });

  const parse = (data: unknown) => () => parseVocabulary(data, 'tags.json', limits);

  it('accepts a valid file and returns tags, presets and version', () => {
    const vocabulary = parseVocabulary(validFile(), 'tags.json', limits);

    expect(vocabulary.tags.map((t) => t.slug)).toEqual(['lon', 'bonus', 'vite']);
    expect(vocabulary.presets).toEqual({ employment: ['lon'], nda: ['vite'] });
    expect(vocabulary.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('rejects a duplicate slug', () => {
    const file = validFile();
    file.tags.push({ ...tag('bonus'), label: 'Annan etikett' });

    expect(parse(file)).toThrow('tags[3] (bonus): duplicate "slug" bonus');
  });

  it('rejects a duplicate label', () => {
    const file = validFile();
    file.tags[1].label = file.tags[0].label;

    expect(parse(file)).toThrow('tags[1] (bonus): duplicate "label" Etikett lon');
  });

  it.each(['slug', 'label', 'description', 'area'])('rejects a missing %s', (field) => {
    const file = validFile();
    delete file.tags[1][field];

    expect(parse(file)).toThrow(`tags[1]`);
    expect(parse(file)).toThrow(`"${field}" must be a non-empty string`);
  });

  it('rejects a label that differs from another only in case', () => {
    const file = validFile();
    file.tags[1].label = 'etikett LON';

    expect(parse(file)).toThrow('tags[1] (bonus): duplicate "label" etikett LON');
  });

  it.each(['label', 'description'])('rejects a %s with surrounding whitespace', (field) => {
    const file = validFile();
    file.tags[0][field] = ` ${file.tags[0][field]}`;

    expect(parse(file)).toThrow(`tags[0] (lon): "${field}" has surrounding whitespace`);
  });

  it('names an entry by index alone when its slug is empty', () => {
    const file = validFile();
    file.tags[1].slug = ' ';

    expect(parse(file)).toThrow(/- tags\[1\]: "slug" must be a non-empty string/);
  });

  it('reports only the unknown area, not the presets or area counts it would affect', () => {
    const file = validFile();
    file.tags[0].area = 'okand';
    const strict = { ...limits, perArea: { min: 1, max: 2 } };

    expect(() => parseVocabulary(file, 'tags.json', strict)).toThrow(
      /^Invalid vocabulary tags\.json:\n- tags\[0\] \(lon\): unknown "area" okand$/,
    );
  });

  it('rejects an empty description', () => {
    const file = validFile();
    file.tags[2].description = '  ';

    expect(parse(file)).toThrow('tags[2] (vite): "description" must be a non-empty string');
  });

  it.each(['Lon', 'lön', 'lon--bonus', '-lon', 'lon bonus'])('rejects the slug %j', (slug) => {
    const file = validFile();
    file.tags[0].slug = slug;
    file.presets.employment = ['bonus'];

    expect(parse(file)).toThrow(`tags[0] (${slug}): "slug" must be lowercase letters`);
  });

  it('rejects an unknown area', () => {
    const file = validFile();
    file.tags[1].area = 'okand';

    expect(parse(file)).toThrow('tags[1] (bonus): unknown "area" okand');
  });

  it('rejects a total outside the limits', () => {
    const file = validFile();
    file.tags = file.tags.slice(0, 1);

    expect(parse(file)).toThrow('the vocabulary has 1 tags, expected 2–4');
  });

  it('rejects an area outside the limits', () => {
    const file = validFile();
    file.tags.push(tag('provision'));

    expect(parse(file)).toThrow('area lon has 3 tags, expected 0–2');
  });

  it('rejects a preset slug that is not in the vocabulary', () => {
    const file = validFile();
    file.presets.nda = ['sekretess'];

    expect(parse(file)).toThrow('presets.nda: unknown slug sekretess');
  });

  it('rejects a duplicate slug within a preset', () => {
    const file = validFile();
    file.presets.employment = ['lon', 'lon'];

    expect(parse(file)).toThrow('presets.employment: duplicate slug lon');
  });

  it('rejects a preset outside the limits and a missing preset', () => {
    const file = validFile();
    file.presets = { employment: ['lon', 'bonus', 'vite'] };

    expect(parse(file)).toThrow('presets.employment has 3 tags, expected 1–2');
    expect(parse(file)).toThrow('presets.nda must be an array of slugs');
  });

  it('reports every problem in one error', () => {
    const file = validFile();
    file.tags[1].area = 'okand';
    file.presets.nda = ['sekretess'];

    expect(parse(file)).toThrow(/unknown "area" okand\n- presets\.nda: unknown slug sekretess/);
  });

  it('names the file when it is not valid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vocabulary-'));
    try {
      const path = join(dir, 'tags.json');
      writeFileSync(path, '{"tags": [],}');

      expect(() => loadVocabulary(path)).toThrow(
        `Invalid vocabulary ${path}: cannot read it as JSON`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a file without tags or presets', () => {
    expect(parse({})).toThrow('"tags" must be an array');
    expect(parse({})).toThrow('"presets" must be an object');
  });
});

describe('vocabularyVersion', () => {
  const tags: VocabularyTag[] = [
    { slug: 'lon', label: 'Lön', description: 'lön', area: 'lon' },
    { slug: 'vite', label: 'Vite', description: 'vite', area: 'skadestand' },
  ];

  it('does not depend on the order of the tags', () => {
    expect(vocabularyVersion([...tags].reverse())).toBe(vocabularyVersion(tags));
  });

  it.each(['slug', 'label', 'description'] as const)('changes when a %s changes', (field) => {
    const changed = tags.map((tag, index) => (index === 0 ? { ...tag, [field]: 'x' } : tag));

    expect(vocabularyVersion(changed)).not.toBe(vocabularyVersion(tags));
  });

  it('changes when an area changes or a tag is removed', () => {
    const moved = tags.map((tag, index) =>
      index === 0 ? { ...tag, area: 'semester' as const } : tag,
    );

    expect(vocabularyVersion(moved)).not.toBe(vocabularyVersion(tags));
    expect(vocabularyVersion(tags.slice(1))).not.toBe(vocabularyVersion(tags));
  });

  it('does not depend on the key order within a tag', () => {
    const reordered = tags.map(({ area, description, label, slug }) => ({
      area,
      description,
      label,
      slug,
    }));

    expect(vocabularyVersion(reordered)).toBe(vocabularyVersion(tags));
  });
});
