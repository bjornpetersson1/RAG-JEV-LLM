import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, resolvePort } from './port.js';

describe('resolvePort', () => {
  it.each([undefined, '', '  '])('falls back to the default port for %j', (value) => {
    expect(resolvePort(value)).toBe(DEFAULT_PORT);
  });

  it('parses a valid port', () => {
    expect(resolvePort('4000')).toBe(4000);
  });

  it.each(['abc', '0', '65536', '30.5'])('rejects %j', (value) => {
    expect(() => resolvePort(value)).toThrow(`Invalid PORT "${value}"`);
  });
});
