import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from './html.js';

describe('decodeHtmlEntities', () => {
  it('decodes decimal, hex and common named entities', () => {
    expect(decodeHtmlEntities('anst&#228;llning 1 &#167; &#xE5;r &amp; &nbsp;')).toBe(
      'anställning 1 § år &  ',
    );
  });

  it('leaves unknown and out-of-range entities as they are', () => {
    expect(decodeHtmlEntities('&unknown; &#99999999;')).toBe('&unknown; &#99999999;');
  });
});
