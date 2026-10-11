// A minimal client for JEV, TypeSafe's model that answers typed questions about a text ("state").
// REST shape from https://docs.typesafe.ai/introduction/quickstart: POST <base>/systemone with a
// bearer key, a state, a model and named questions; the answers come back under the same names.

import { describeError } from '../errors.js';
import { elapsedMs, isFetchAbort, isFetchTimeout } from '../http.js';
import { NO_USAGE, type LlmLogger, type LlmUsage } from '../llm/client.js';
import type { RoleName } from '../llm/types.js';
import type { JevConfig } from './config.js';

/** "How likely is this statement true of the state?", answered 0–1. */
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
}

/** Picks one option; `criteria` maps each option's name to its description. */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export type JevQuestion = NoulQuestion | ChoiceQuestion;

interface NoulAnswer {
  type: 'noul';
  noul: number;
}

interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  confidence?: number;
  /** Probability per option. */
  probabilities: Record<string, number>;
}

export type JevAnswer = NoulAnswer | ChoiceAnswer;

export interface JevResponse {
  /** The answers, keyed by the question names asked. */
  answers: Record<string, JevAnswer>;
  /** JEV's token counts; JEV has no prompt cache, so the cache counts are 0. */
  usage: LlmUsage;
}

export interface JevClient {
  /** Asks `questions` about `state`; `signal` cancels the call, e.g. when a parallel call failed. */
  ask(
    state: string,
    questions: Record<string, JevQuestion>,
    signal?: AbortSignal,
  ): Promise<JevResponse>;
}

type JevErrorKind = 'http' | 'timeout' | 'aborted' | 'network' | 'response';

export class JevError extends Error {
  constructor(
    readonly kind: JevErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

interface JevClientOptions extends JevConfig {
  /** The role the calls are for, so its log entries can be told apart from other roles'. */
  role: RoleName;
  logger: LlmLogger;
  fetch?: typeof fetch;
}

/**
 * One POST per `ask`, no retries. Every call is logged once, with the same fields as the LLM
 * clients' entries (role, provider, model, latency, tokens or the error).
 */
export function createJevClient(options: JevClientOptions): JevClient {
  const { role, apiKey, baseUrl, model, timeoutMs, logger } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const url = `${baseUrl}/systemone`;

  return {
    async ask(state, questions, signal) {
      const started = performance.now();
      const entry = { role, provider: 'jev', model, questions: Object.keys(questions).length };
      try {
        const response = readResponse(
          await post(JSON.stringify({ state, model, questions }), signal),
          questions,
        );
        logger.info({ ...entry, latencyMs: elapsedMs(started), ...response.usage }, 'JEV call');
        return response;
      } catch (error) {
        logger.error(
          { ...entry, latencyMs: elapsedMs(started), error: describeError(error) },
          'JEV call failed',
        );
        throw error;
      }
    },
  };

  /** The parsed JSON body; any failure on the way is a {@link JevError}. */
  async function post(body: string, cancel: AbortSignal | undefined): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body,
        signal: cancel ? AbortSignal.any([timeout, cancel]) : timeout,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new JevError(
          'http',
          `JEV answered HTTP ${response.status}: ${detail}`,
          response.status,
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof JevError) throw error;
      if (isFetchTimeout(error)) {
        throw new JevError('timeout', `JEV did not answer within ${timeoutMs} ms`);
      }
      if (isFetchAbort(error)) throw new JevError('aborted', 'The JEV call was cancelled');
      if (error instanceof SyntaxError) {
        throw new JevError('response', 'JEV answered with a body that is not JSON');
      }
      throw new JevError('network', `JEV could not be reached: ${describeError(error)}`);
    }
  }
}

/**
 * The answer to every question, each of the type asked for with values from 0 to 1; throws on
 * anything else.
 */
function readResponse(body: unknown, questions: Record<string, JevQuestion>): JevResponse {
  const answers = (body as { answers?: unknown } | null)?.answers;
  if (typeof answers !== 'object' || answers === null) throw malformed('no "answers" object');
  const read: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(questions)) {
    const answer = (answers as Record<string, unknown>)[name];
    const valid = question.type === 'noul' ? isNoulAnswer(answer) : isChoiceAnswer(answer);
    if (!valid) throw malformed(`no valid ${question.type} answer to "${name}"`);
    read[name] = answer as JevAnswer;
  }
  const usage = (body as { usage?: { input_tokens?: unknown; output_tokens?: unknown } }).usage;
  return {
    answers: read,
    usage: {
      ...NO_USAGE,
      inputTokens: typeof usage?.input_tokens === 'number' ? usage.input_tokens : 0,
      outputTokens: typeof usage?.output_tokens === 'number' ? usage.output_tokens : 0,
    },
  };
}

function isNoulAnswer(value: unknown): value is NoulAnswer {
  const answer = value as Partial<NoulAnswer> | null;
  return answer?.type === 'noul' && isProbability(answer.noul);
}

function isChoiceAnswer(value: unknown): value is ChoiceAnswer {
  const answer = value as Partial<ChoiceAnswer> | null;
  return (
    answer?.type === 'choice' &&
    typeof answer.choice === 'string' &&
    typeof answer.probabilities === 'object' &&
    answer.probabilities !== null &&
    Object.values(answer.probabilities).every(isProbability)
  );
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

function malformed(problem: string): JevError {
  return new JevError('response', `JEV answered with a malformed response: ${problem}`);
}
