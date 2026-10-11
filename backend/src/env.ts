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

/** The number from 0 to 1 at `key`, or `fallback` when it is unset or empty. */
export function readShare(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const value = env[key]?.trim();
  if (!value) return fallback;
  // Plain decimals only: Number() would also accept "0x1" or "1e-1".
  const share = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!(share >= 0 && share <= 1)) {
    throw new Error(`Invalid ${key} "${value}": expected a number from 0 to 1`);
  }
  return share;
}

/** `true` or `false` at `key`, or `fallback` when it is unset or empty. */
export function readBoolean(
  env: Record<string, string | undefined>,
  key: string,
  fallback: boolean,
): boolean {
  return readOneOf(env, key, ['true', 'false'], fallback ? 'true' : 'false') === 'true';
}

/** One of `values` at `key`, or `fallback` when it is unset or empty. */
export function readOneOf<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  values: readonly T[],
  fallback: T,
): T {
  const value = env[key]?.trim();
  if (!value) return fallback;
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${key} "${value}": expected ${values.join(' or ')}`);
  }
  return value as T;
}
