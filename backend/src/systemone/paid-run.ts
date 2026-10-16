// The guard in front of every batch run that calls SubQ (E9-1): every SubQ call is billed, so a
// script first prints what the run will cost at most and goes on only when the owner confirms, and
// prints what it actually cost at the end.

import { createInterface } from 'node:readline/promises';
import type { LlmLogger } from '../llm/client.js';
import { formatUsd } from '../llm/pricing.js';
import { sum } from '../stats.js';

/** `subq-snap-preview`'s price; output is free (https://docs.subq.ai/using-the-api/models/). */
export const SUBQ_USD_PER_MILLION_INPUT_TOKENS = 0.05;

/**
 * Characters per token for the estimate. SubQ's tokenizer is not published; measured on 2026-10-15,
 * chunks came to about 3.7 characters per token but a translation's many short tag questions to
 * about 2.8, so 2 keeps the estimate above both.
 */
const CHARS_PER_TOKEN = 2;

/** The question and JSON around a call's state, in characters; generous, so the estimate stays an upper bound. */
const CALL_OVERHEAD_CHARS = 200;

/** SubQ calls and the characters they send, at most. */
export interface PaidCalls {
  calls: number;
  chars: number;
}

export const NO_CALLS: PaidCalls = { calls: 0, chars: 0 };

interface CostEstimate {
  calls: number;
  inputTokens: number;
  usd: number;
}

export function addCalls(...parts: readonly PaidCalls[]): PaidCalls {
  return {
    calls: sum(parts.map((part) => part.calls)),
    chars: sum(parts.map((part) => part.chars)),
  };
}

/** `paid`, `times` over. */
export function timesCalls(paid: PaidCalls, times: number): PaidCalls {
  return { calls: paid.calls * times, chars: paid.chars * times };
}

/** `count` calls of `charsPerCall` characters each. */
export function callsOf(count: number, charsPerCall: number): PaidCalls {
  return { calls: count, chars: count * (charsPerCall + CALL_OVERHEAD_CHARS) };
}

/** The cost of `paid` at SubQ's price. */
export function estimateCost({ calls, chars }: PaidCalls): CostEstimate {
  const inputTokens = Math.ceil(chars / CHARS_PER_TOKEN);
  return { calls, inputTokens, usd: costOfTokens(inputTokens) };
}

function costOfTokens(inputTokens: number): number {
  return (inputTokens / 1_000_000) * SUBQ_USD_PER_MILLION_INPUT_TOKENS;
}

function formatEstimate({ calls, inputTokens, usd }: CostEstimate): string {
  return `${calls} SubQ calls, ${inputTokens} input tokens, ${formatUsd(usd)}`;
}

export interface ConfirmOptions {
  /** `--yes`: go on without asking. */
  yes: boolean;
  input?: NodeJS.ReadableStream & { isTTY?: boolean };
  output?: NodeJS.WritableStream;
}

/**
 * Prints the estimate and whether the run goes on: always with `--yes`, else only on `y` or `yes`
 * typed at an interactive prompt. Without a terminal to ask at, the run stops.
 */
export async function confirmPaidRun(
  estimate: CostEstimate,
  { yes, input = process.stdin, output = process.stdout }: ConfirmOptions,
): Promise<boolean> {
  output.write(`This run calls the paid SubQ API: at most ${formatEstimate(estimate)}.\n`);
  if (yes) return true;
  if (!input.isTTY) {
    output.write('Stopped: no terminal to confirm at. Run again with --yes to go on.\n');
    return false;
  }
  const prompt = createInterface({ input, output });
  try {
    const answer = (await prompt.question('Continue? [y/N] ')).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    output.write('Stopped.\n');
    return false;
  } finally {
    prompt.close();
  }
}

/** SubQ's calls and input tokens as the client reported them. */
interface SubqUsage {
  calls: number;
  inputTokens: number;
}

/**
 * `logger`, also counting the SubQ calls the System One client logs and the input tokens SubQ
 * reported for them, so a run can say what it actually cost.
 */
export function meterSubqUsage(logger: LlmLogger): { logger: LlmLogger; used(): SubqUsage } {
  const usage: SubqUsage = { calls: 0, inputTokens: 0 };
  return {
    logger: {
      warn: (entry, message) => logger.warn(entry, message),
      error: (entry, message) => logger.error(entry, message),
      info(entry, message) {
        const { provider, inputTokens } = entry as { provider?: unknown; inputTokens?: unknown };
        if (provider === 'subq' && typeof inputTokens === 'number') {
          usage.calls += 1;
          usage.inputTokens += inputTokens;
        }
        logger.info(entry, message);
      },
    },
    used: () => ({ ...usage }),
  };
}

export function formatUsage({ calls, inputTokens }: SubqUsage): string {
  return `SubQ used: ${calls} calls, ${inputTokens} input tokens, ${formatUsd(costOfTokens(inputTokens))}`;
}
