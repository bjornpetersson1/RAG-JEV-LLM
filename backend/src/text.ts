/**
 * The lower-case words of `text`: runs of letters and digits, so å, ä and ö stay inside words. The
 * text is composed (NFC) first, so a decomposed "ö" (o plus a combining mark) does not split a word.
 */
export function words(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/** Any run of whitespace, including the non-breaking spaces `&nbsp;` decodes to, as one space, trimmed. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
