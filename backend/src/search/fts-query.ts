import { words } from '../text.js';

/** Common Swedish function words, left out of full-text queries. */
const STOP_WORDS = new Set([
  'alla',
  'att',
  'av',
  'de',
  'den',
  'det',
  'dess',
  'dig',
  'du',
  'eller',
  'en',
  'ett',
  'för',
  'från',
  'har',
  'hon',
  'han',
  'i',
  'inte',
  'jag',
  'kan',
  'man',
  'med',
  'men',
  'mot',
  'när',
  'och',
  'om',
  'på',
  'sig',
  'ska',
  'skall',
  'som',
  'till',
  'under',
  'upp',
  'ut',
  'vi',
  'vid',
  'är',
]);

/** Shorter words (e.g. "ab", "7") would match far too much as prefixes, so they are left out. */
const MIN_WORD_LENGTH = 3;

/** A word this long or longer loses up to {@link MAX_TRIM} letters, keeping {@link MIN_STEM}. */
const TRIM_FROM_LENGTH = 6;
const MAX_TRIM = 3;
const MIN_STEM = 5;

/**
 * An FTS5 query from the instruction and the chosen tags' labels: every distinct word of at least
 * three characters except stop words, joined with OR. Words are prefix terms, cut first when long so
 * inflected forms match (`uppsägningen` → `"uppsägnin"*`); numbers must match exactly
 * (`"1982"`). Null when no word is left.
 */
export function buildFtsQuery(instruction: string, tagLabels: readonly string[]): string | null {
  const kept = words([instruction, ...tagLabels].join(' ')).filter(
    (word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word),
  );
  const terms = [...new Set(kept.map(term))];
  return terms.length > 0 ? terms.join(' OR ') : null;
}

function term(word: string): string {
  if (/^\p{N}+$/u.test(word)) return `"${word}"`;
  const stem =
    word.length < TRIM_FROM_LENGTH
      ? word
      : word.slice(0, Math.max(MIN_STEM, word.length - MAX_TRIM));
  return `"${stem}"*`;
}
