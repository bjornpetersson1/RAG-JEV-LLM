const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes numeric (`&#228;`, `&#xE4;`) and the common named HTML entities; others stay as they are. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith('#')) {
      const isHex = name[1] === 'x' || name[1] === 'X';
      const code = Number.parseInt(name.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}
