import { describeError } from '../errors.js';

export interface Failure {
  identifier: string;
  reason: string;
}

/**
 * Runs `work` for each document, logging and collecting a failure instead of stopping, so one bad
 * document does not hold up the rest.
 */
export function forEachDocument<T>(
  documents: T[],
  identifierOf: (document: T) => string,
  work: (document: T) => void,
  log: (message: string) => void,
): Failure[] {
  const failures: Failure[] = [];
  for (const document of documents) {
    try {
      work(document);
    } catch (error) {
      const failure = { identifier: identifierOf(document), reason: describeError(error) };
      failures.push(failure);
      log(`Failed ${failure.identifier}: ${failure.reason}`);
    }
  }
  return failures;
}
