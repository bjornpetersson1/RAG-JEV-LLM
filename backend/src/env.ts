/** `value` as a positive integer, or undefined unless it is plain digits above zero. */
export function parsePositiveInteger(value: string): number | undefined {
  // Only plain digits: Number() would also accept "2e3", "0x7D0" or "2000.0".
  const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

/** The positive integer at `key`, or `fallback` when it is unset or empty. */
export function readPositiveInteger(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const value = env[key]?.trim();
  if (!value) return fallback;
  const parsed = parsePositiveInteger(value);
  if (parsed === undefined) {
    throw new Error(`Invalid ${key} "${value}": expected a positive integer`);
  }
  return parsed;
}
