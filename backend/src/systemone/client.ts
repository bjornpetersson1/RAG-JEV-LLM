// A minimal client for the System One models, which answer typed questions about a text ("state"):
// TypeSafe's JEV and Subquadratic's SubQ. REST shape from
// https://docs.typesafe.ai/introduction/quickstart and https://docs.subq.ai/endpoints/decisions-api/:
// POST <base>/systemone with a bearer key, a state, a model and named questions; the answers come
// back under the same names.

import { describeError } from '../errors.js';
import { elapsedMs, isFetchAbort, isFetchTimeout } from '../http.js';
import { NO_USAGE, type LlmLogger, type LlmUsage } from '../llm/client.js';
import type { RoleName } from '../llm/types.js';
import { PROVIDER_NAMES, type SystemOneConfig, type SystemOneProvider } from './config.js';

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

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion;

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

export type SystemOneAnswer = NoulAnswer | ChoiceAnswer;

export interface SystemOneResponse {
  /** The answers, keyed by the question names asked. */
  answers: Record<string, SystemOneAnswer>;
  /** The model's token counts; there is no prompt cache, so the cache counts are 0. */
  usage: LlmUsage;
}

export interface SystemOneClient {
  /** Which model answers. */
  readonly provider: SystemOneProvider;
  /** Asks `questions` about `state`; `signal` cancels the call, e.g. when a parallel call failed. */
  ask(
    state: string,
    questions: Record<string, SystemOneQuestion>,
    signal?: AbortSignal,
  ): Promise<SystemOneResponse>;
}

type SystemOneErrorKind = 'http' | 'timeout' | 'aborted' | 'network' | 'response';

export class SystemOneError extends Error {
  constructor(
    /** Which model failed. */
    readonly provider: SystemOneProvider,
    readonly kind: SystemOneErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SystemOneError';
  }
}

interface SystemOneClientOptions extends SystemOneConfig {
  provider: SystemOneProvider;
  /** The role the calls are for, so its log entries can be told apart from other roles'. */
  role: RoleName;
  logger: LlmLogger;
  fetch?: typeof fetch;
}

/**
 * One POST per `ask`, no retries. Every call is logged once, with the same fields as the LLM
 * clients' entries (role, provider, model, latency, tokens or the error).
 */
export function createSystemOneClient(options: SystemOneClientOptions): SystemOneClient {
  const { provider, role, apiKey, baseUrl, model, timeoutMs, logger } = options;
  const name = PROVIDER_NAMES[provider];
  const fetchFn = options.fetch ?? globalThis.fetch;
  const url = `${baseUrl}/systemone`;

  return {
    provider,
    async ask(state, questions, signal) {
      const started = performance.now();
      const entry = { role, provider, model, questions: Object.keys(questions).length };
      try {
        const response = readResponse(
          await post(JSON.stringify({ state, model, questions }), signal),
          questions,
        );
        logger.info({ ...entry, latencyMs: elapsedMs(started), ...response.usage }, `${name} call`);
        return response;
      } catch (error) {
        const failure = { ...entry, latencyMs: elapsedMs(started), error: describeError(error) };
        // A cancellation is the caller's decision (e.g. a timeout of its own), not a model failure.
        if (error instanceof SystemOneError && error.kind === 'aborted') {
          logger.info(failure, `${name} call cancelled`);
        } else {
          logger.error(failure, `${name} call failed`);
        }
        throw error;
      }
    },
  };

  /** The parsed JSON body; any failure on the way is a {@link SystemOneError}. */
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
        const detail = errorDetail(await response.text());
        const answered =
          response.status === 402
            ? `${name} is out of credits (HTTP 402)`
            : `${name} answered HTTP ${response.status}`;
        throw new SystemOneError(provider, 'http', `${answered}: ${detail}`, response.status);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof SystemOneError) throw error;
      if (isFetchTimeout(error)) {
        throw new SystemOneError(
          provider,
          'timeout',
          `${name} did not answer within ${timeoutMs} ms`,
        );
      }
      if (isFetchAbort(error))
        throw new SystemOneError(provider, 'aborted', `The ${name} call was cancelled`);
      if (error instanceof SyntaxError) {
        throw new SystemOneError(
          provider,
          'response',
          `${name} answered with a body that is not JSON`,
        );
      }
      throw new SystemOneError(
        provider,
        'network',
        `${name} could not be reached: ${describeError(error)}`,
      );
    }
  }

  /**
   * The answer to every question, each of the type asked for with values from 0 to 1; throws on
   * anything else.
   */
  function readResponse(
    body: unknown,
    questions: Record<string, SystemOneQuestion>,
  ): SystemOneResponse {
    const answers = (body as { answers?: unknown } | null)?.answers;
    if (typeof answers !== 'object' || answers === null) throw malformed('no "answers" object');
    const read: Record<string, SystemOneAnswer> = {};
    for (const [key, question] of Object.entries(questions)) {
      const answer = (answers as Record<string, unknown>)[key];
      const valid = question.type === 'noul' ? isNoulAnswer(answer) : isChoiceAnswer(answer);
      if (!valid) throw malformed(`no valid ${question.type} answer to "${key}"`);
      read[key] = answer as SystemOneAnswer;
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

  function malformed(problem: string): SystemOneError {
    return new SystemOneError(
      provider,
      'response',
      `${name} answered with a malformed response: ${problem}`,
    );
  }
}

/**
 * An error body for the message: SubQ's `{ detail: { error_type, message } }` as `type: message`,
 * anything else as its first 200 characters.
 */
function errorDetail(body: string): string {
  try {
    const detail = (JSON.parse(body) as { detail?: { error_type?: unknown; message?: unknown } })
      .detail;
    if (typeof detail?.error_type === 'string' && typeof detail.message === 'string') {
      return `${detail.error_type}: ${detail.message}`.slice(0, 200);
    }
  } catch {
    // Not JSON; the raw text says what there is to say.
  }
  return body.slice(0, 200);
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
