/** The error message followed by its causes, e.g. "Migration 2_x failed: no such table: y". */
export function describeError(error: unknown): string {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  return messages.length > 0 ? messages.join(': ') : String(error);
}
