/**
 * Whether a `fetch` failed because its `AbortSignal.timeout` fired. A deliberate cancellation
 * (`AbortController.abort()`) is an `AbortError` instead and is not a timeout.
 */
export function isFetchTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

/** Whether a `fetch` was cancelled through its caller's `AbortSignal`. */
export function isFetchAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Whole milliseconds since `started` (a `performance.now()` reading). */
export function elapsedMs(started: number): number {
  return Math.round(performance.now() - started);
}

/** Node timers (and so `AbortSignal.timeout`) cannot represent delays above 2^31 - 1 ms. */
export const MAX_TIMER_MS = 2 ** 31 - 1;
