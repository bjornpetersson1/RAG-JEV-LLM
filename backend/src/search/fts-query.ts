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
  return queryOf(
    [instruction, ...tagLabels].join(' '),
    (word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word),
  );
}

/**
 * An FTS5 query for the lexical half of hybrid retrieval (E8-4): like {@link buildFtsQuery}, but
 * every number is kept whatever its length, so section numbers ("7", "33") and the parts of an SFS
 * number ("1982", "80") match the chunks' `source_ref`. Null when no term is left.
 */
export function buildLexicalQuery(text: string): string | null {
  return queryOf(
    text,
    (word) => isNumber(word) || (word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word)),
  );
}

/** The distinct terms of the words `keep` accepts, joined with OR; null when none is left. */
function queryOf(text: string, keep: (word: string) => boolean): string | null {
  const terms = [...new Set(words(text).filter(keep).map(term))];
  return terms.length > 0 ? terms.join(' OR ') : null;
}

function isNumber(word: string): boolean {
  return /^\p{N}+$/u.test(word);
}

function term(word: string): string {
  if (isNumber(word)) return `"${word}"`;
  const stem =
    word.length < TRIM_FROM_LENGTH
      ? word
      : word.slice(0, Math.max(MIN_STEM, word.length - MAX_TRIM));
  return `"${stem}"*`;
}
