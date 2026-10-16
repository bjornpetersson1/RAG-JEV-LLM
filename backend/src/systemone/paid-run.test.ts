import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../llm/test-helpers.js';
import {
  callsOf,
  confirmPaidRun,
  estimateCost,
  formatUsage,
  meterSubqUsage,
  SUBQ_USD_PER_MILLION_INPUT_TOKENS,
} from './paid-run.js';

const ESTIMATE = { calls: 40, inputTokens: 200_000, usd: 0.01 };

/** A stream to write to and read everything written back. */
function output() {
  const stream = new PassThrough();
  let text = '';
  stream.on('data', (chunk: Buffer) => (text += chunk.toString()));
  return { stream, text: () => text };
}

/** Standard input as a terminal that answers `answer`, or a pipe. */
function input(isTTY: boolean, answer = '') {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean };
  stream.isTTY = isTTY;
  if (answer) setImmediate(() => stream.write(`${answer}\n`));
  return stream;
}

describe('confirmPaidRun', () => {
  it('prints the estimate and goes on with --yes', async () => {
    const out = output();

    await expect(
      confirmPaidRun(ESTIMATE, { yes: true, input: input(false), output: out.stream }),
    ).resolves.toBe(true);
    expect(out.text()).toContain(
      'This run calls the paid SubQ API: at most 40 SubQ calls, 200000 input tokens, 0.0100 USD',
    );
  });

  it('stops without --yes when there is no terminal to ask at', async () => {
    const out = output();

    await expect(
      confirmPaidRun(ESTIMATE, { yes: false, input: input(false), output: out.stream }),
    ).resolves.toBe(false);
    expect(out.text()).toContain('Run again with --yes to go on');
  });

  it.each([
    ['y', true],
    ['yes', true],
    ['n', false],
    ['nej', false],
  ])('at a terminal, the answer %s goes on: %s', async (answer, goesOn) => {
    await expect(
      confirmPaidRun(ESTIMATE, { yes: false, input: input(true, answer), output: output().stream }),
    ).resolves.toBe(goesOn);
  });
});

describe('estimateCost', () => {
  it('counts a token per 2 characters, rounded up, at $0.05 per million', () => {
    expect(SUBQ_USD_PER_MILLION_INPUT_TOKENS).toBe(0.05);
    expect(estimateCost(callsOf(2, 100))).toEqual({
      calls: 2,
      inputTokens: 300,
      usd: (300 / 1_000_000) * 0.05,
    });
  });
});

describe('meterSubqUsage', () => {
  it('sums the input tokens of the SubQ calls the client logs, and passes every entry on', () => {
    const logger = createCapturingLogger();
    const meter = meterSubqUsage(logger);

    meter.logger.info({ provider: 'subq', inputTokens: 400 }, 'SubQ call');
    meter.logger.info({ provider: 'subq', inputTokens: 600 }, 'SubQ call');
    meter.logger.info({ provider: 'jev', inputTokens: 999 }, 'JEV call');
    meter.logger.warn({ chunkId: 'c1' }, 'SubQ failed, judging with the LLM instead');

    expect(meter.used()).toEqual({ calls: 2, inputTokens: 1000 });
    expect(logger.info).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(formatUsage(meter.used())).toBe('SubQ used: 2 calls, 1000 input tokens, 0.0001 USD');
  });
});
