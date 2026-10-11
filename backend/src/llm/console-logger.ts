import type { LlmLogger } from './client.js';

/**
 * A logger for CLI commands: each entry as its message followed by the entry as JSON. `quiet`
 * drops the info lines, for long runs where only problems are worth showing.
 */
export function createConsoleLogger({ quiet = false } = {}): LlmLogger {
  const line = (entry: object, message: string) => `${message} ${JSON.stringify(entry)}`;
  return {
    info: quiet ? () => {} : (entry, message) => console.log(line(entry, message)),
    warn: (entry, message) => console.warn(line(entry, message)),
    error: (entry, message) => console.error(line(entry, message)),
  };
}
