// @vitest-environment node
/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE_DIR = new URL('./', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, SOURCE_DIR), 'utf8');
const tokens = read('tokens.css');
const styles = read('styles.css');

/** The colour tokens on `:root`, by name without the `--color-` prefix. */
function colourTokens(): Record<string, string> {
  return Object.fromEntries(
    [...tokens.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [
      name,
      hex,
    ]),
  );
}

/** WCAG 2.1 relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Every text colour on every background styles.css puts it on (E7-13, WCAG AA 4.5:1). The 4.5:1 also
 * covers the 3:1 the accent focus ring and the ink outlines need.
 */
const TEXT_PAIRS: [text: string, background: string][] = [
  ['ink', 'paper'],
  ['ink', 'surface'],
  ['ink', 'sunken'],
  ['ink', 'mustard-soft'],
  ['ink', 'salmon-soft'],
  ['ink', 'orange'],
  ['ink', 'mustard'],
  ['surface', 'ink'],
  ['ink-muted', 'paper'],
  ['ink-muted', 'surface'],
  ['ink-muted', 'sunken'],
  ['ink-muted', 'mustard-soft'],
  ['accent', 'paper'],
  ['accent', 'surface'],
  ['accent', 'mustard-soft'],
  ['error', 'surface'],
  ['error', 'error-soft'],
];

describe('design tokens', () => {
  const colours = colourTokens();

  it.each(TEXT_PAIRS)('%s text on %s meets WCAG AA', (text, background) => {
    expect(colours[text]).toBeDefined();
    expect(colours[background]).toBeDefined();
    expect(contrast(colours[text], colours[background])).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves no colour, font size, border width or spacing literal outside the tokens', () => {
    expect(styles).toContain('var(--color-ink)');
    const rules = styles.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rules).not.toMatch(/\b(rgba?|hsla?)\(/i);
    expect(rules).not.toMatch(/font-size:(?!\s*var\()/);
    expect(rules).not.toMatch(/font:(?!\s*inherit)/);
    expect(rules).not.toMatch(/(border|outline)[\w-]*:\s*[\d.]+(px|rem)/);
    expect(rules).not.toMatch(/(margin|padding|gap)[\w-]*:[^;]*\d(px|rem|em)\b/);
  });

  it('loads no font from the network', () => {
    const sources = readdirSync(SOURCE_DIR)
      .filter((file) => /\.(css|tsx?)$/.test(file) && !file.includes('.test.'))
      .map(read);
    for (const text of [read('../index.html'), ...sources]) {
      expect(text).not.toMatch(/fonts\.(googleapis|gstatic)\.com|@import\s+url\(\s*['"]?https?:/);
    }
  });
});
