import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The areas the vocabulary is grouped into, with their Swedish display names. */
export const AREAS = {
  anstallning: 'Anställningsformer och anställningsavtal',
  uppsagning: 'Uppsägning och avskedande',
  konkurrens: 'Konkurrensklausuler och värvningsförbud',
  sekretess: 'Sekretess, företagshemligheter och lojalitetsplikt',
  lon: 'Lön och förmåner',
  arbetstid: 'Arbetstid och ledighet',
  semester: 'Semester',
  diskriminering: 'Diskriminering',
  avtalsratt: 'Avtalsrätt och avtalstolkning',
  skadestand: 'Skadestånd, vite och påföljder',
} as const;

export type Area = keyof typeof AREAS;

export const TEMPLATES = ['employment', 'nda'] as const;

export type Template = (typeof TEMPLATES)[number];

export interface VocabularyTag {
  slug: string;
  label: string;
  /** A Swedish phrase that completes "Handlar texten om …?". */
  description: string;
  area: Area;
}

export interface Vocabulary {
  tags: VocabularyTag[];
  /** The preset tag slugs for each document template. */
  presets: Record<Template, string[]>;
  /** Changes exactly when a tag's slug, label, description or area changes. */
  version: string;
}

export interface VocabularyLimits {
  tags: { min: number; max: number };
  perArea: { min: number; max: number };
  perPreset: { min: number; max: number };
}

const DEFAULT_LIMITS: VocabularyLimits = {
  tags: { min: 100, max: 300 },
  perArea: { min: 5, max: 30 },
  perPreset: { min: 10, max: 25 },
};

export const TAG_FIELDS = ['slug', 'label', 'description', 'area'] as const;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_LENGTH = 12;

/** Reads and validates a vocabulary file. */
export function loadVocabulary(path: string, limits = DEFAULT_LIMITS): Vocabulary {
  const text = readFileSync(path, 'utf8');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid vocabulary ${path}: cannot read it as JSON`, { cause: error });
  }
  return parseVocabulary(data, path, limits);
}

/** Validates parsed vocabulary JSON, reporting every problem in one error. */
export function parseVocabulary(
  data: unknown,
  source: string,
  limits = DEFAULT_LIMITS,
): Vocabulary {
  const errors: string[] = [];
  const file = isObject(data) ? data : {};
  let entries: unknown[] = [];
  if (Array.isArray(file.tags)) entries = file.tags;
  else errors.push('"tags" must be an array');
  let rawPresets: Record<string, unknown> = {};
  if (isObject(file.presets)) rawPresets = file.presets;
  else errors.push('"presets" must be an object');

  const { tags, slugs } = checkTags(entries, limits, errors);
  const presets = checkPresets(rawPresets, slugs, limits, errors);

  if (errors.length > 0) {
    throw new Error(`Invalid vocabulary ${source}:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  }
  return { tags, presets, version: vocabularyVersion(tags) };
}

/** A short hash of the tags' content, independent of their order in the file. */
export function vocabularyVersion(tags: readonly VocabularyTag[]): string {
  const canonical = [...tags]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((tag) => TAG_FIELDS.map((field) => tag[field]));
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex')
    .slice(0, VERSION_LENGTH);
}

/**
 * Checks every tag entry. Returns the valid tags and every slug the file names, so that a tag with
 * another problem does not also make the presets that use it fail as "unknown slug".
 */
function checkTags(entries: unknown[], limits: VocabularyLimits, errors: string[]) {
  const tags: VocabularyTag[] = [];
  const slugs = new Set<string>();
  // Labels differing only in case look the same to the tagger and in the UI.
  const labelKeys = new Set<string>();
  let unknownAreas = 0;

  entries.forEach((entry, index) => {
    const tag = isObject(entry) ? entry : {};
    const named = typeof tag.slug === 'string' && tag.slug.trim() !== '';
    const where = `tags[${index}]${named ? ` (${tag.slug})` : ''}`;
    const missing = TAG_FIELDS.filter(
      (field) => typeof tag[field] !== 'string' || (tag[field] as string).trim() === '',
    );
    for (const field of missing) errors.push(`${where}: "${field}" must be a non-empty string`);
    if (named && slugs.has(tag.slug as string)) {
      errors.push(`${where}: duplicate "slug" ${tag.slug}`);
    }
    if (named) slugs.add(tag.slug as string);
    if (missing.length > 0) return;

    const { slug, label, description, area } = tag as Record<string, string>;
    if (!SLUG_PATTERN.test(slug)) {
      errors.push(`${where}: "slug" must be lowercase letters a–z, digits and single hyphens`);
    }
    for (const [field, value] of [
      ['label', label],
      ['description', description],
    ]) {
      if (value !== value.trim()) errors.push(`${where}: "${field}" has surrounding whitespace`);
    }
    const labelKey = label.trim().toLocaleLowerCase('sv-SE');
    if (labelKeys.has(labelKey)) errors.push(`${where}: duplicate "label" ${label}`);
    labelKeys.add(labelKey);
    if (!isArea(area)) {
      errors.push(`${where}: unknown "area" ${area}`);
      unknownAreas++;
      return;
    }
    tags.push({ slug, label, description, area });
  });

  checkCount('the vocabulary', entries.length, limits.tags, errors);
  // With an unknown area, the per-area counts would point at the wrong problem.
  if (unknownAreas === 0) {
    for (const area of Object.keys(AREAS) as Area[]) {
      const count = tags.filter((tag) => tag.area === area).length;
      checkCount(`area ${area}`, count, limits.perArea, errors);
    }
  }
  return { tags, slugs };
}

function checkPresets(
  presets: Record<string, unknown>,
  slugs: ReadonlySet<string>,
  limits: VocabularyLimits,
  errors: string[],
): Record<Template, string[]> {
  const checked = {} as Record<Template, string[]>;
  for (const template of TEMPLATES) {
    const preset = presets[template];
    if (!Array.isArray(preset) || !preset.every((slug) => typeof slug === 'string')) {
      errors.push(`presets.${template} must be an array of slugs`);
      checked[template] = [];
      continue;
    }
    const seen = new Set<string>();
    for (const slug of preset) {
      if (!slugs.has(slug)) errors.push(`presets.${template}: unknown slug ${slug}`);
      if (seen.has(slug)) errors.push(`presets.${template}: duplicate slug ${slug}`);
      seen.add(slug);
    }
    checkCount(`presets.${template}`, preset.length, limits.perPreset, errors);
    checked[template] = preset;
  }
  return checked;
}

function checkCount(
  what: string,
  count: number,
  range: { min: number; max: number },
  errors: string[],
): void {
  if (count < range.min || count > range.max) {
    errors.push(`${what} has ${count} tags, expected ${range.min}–${range.max}`);
  }
}

function isArea(value: string): value is Area {
  return Object.hasOwn(AREAS, value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
