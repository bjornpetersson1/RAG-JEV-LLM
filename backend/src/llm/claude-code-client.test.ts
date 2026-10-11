import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  createClaudeCodeClient,
  runProcess,
  type ProcessResult,
  type RunProcess,
} from './claude-code-client.js';
import { loadLlmConfig } from './config.js';
import { createLlmRoles } from './factory.js';
import { createCapturingLogger } from './test-helpers.js';

const REQUEST = {
  system: 'Svara med en poäng.',
  prompt: 'Är texten relevant?',
  schema: { type: 'object', properties: { score: { type: 'number' } }, required: ['score'] },
};

function printResult(fields: object): ProcessResult {
  return { exitCode: 0, stdout: JSON.stringify(fields), stderr: '', timedOut: false };
}

const ANSWER = printResult({
  is_error: false,
  result: '{"score":0.85}',
  structured_output: { score: 0.85 },
  usage: {
    input_tokens: 2,
    output_tokens: 239,
    cache_creation_input_tokens: 1161,
    cache_read_input_tokens: 0,
  },
});

function clientWith(...results: (ProcessResult | Error)[]) {
  const run = vi.fn<RunProcess>(async () => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next!;
  });
  const logger = createCapturingLogger();
  const client = createClaudeCodeClient({
    role: 'judge',
    model: 'claude-haiku-5-5',
    timeoutMs: 1000,
    maxRetries: 1,
    logger,
    run,
    sleep: async () => {},
  });
  return { client, run, logger };
}

describe('createClaudeCodeClient', () => {
  it('runs claude in print mode with the schema, system prompt and model, without tools', async () => {
    const { client, run } = clientWith(ANSWER);

    await client.complete(REQUEST);

    expect(run).toHaveBeenCalledWith(
      'claude',
      [
        '-p',
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(REQUEST.schema),
        '--system-prompt',
        REQUEST.system,
        '--model',
        'claude-haiku-5-5',
        '--tools',
        '',
        '--no-session-persistence',
        '--setting-sources',
        '',
      ],
      { input: REQUEST.prompt, timeoutMs: 1000 },
    );
  });

  it('returns the structured output and token usage, and logs the call', async () => {
    const { client, logger } = clientWith(ANSWER);

    await expect(client.complete(REQUEST)).resolves.toEqual({
      data: { score: 0.85 },
      usage: { inputTokens: 2, outputTokens: 239, cacheWriteTokens: 1161, cacheReadTokens: 0 },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'judge',
        provider: 'claude-code',
        model: 'claude-haiku-5-5',
        latencyMs: expect.any(Number),
      }),
      'LLM call',
    );
  });

  it('retries a non-zero exit and a timeout', async () => {
    const failed = { exitCode: 1, stdout: '', stderr: 'overloaded', timedOut: false };
    const { client, run } = clientWith(failed, ANSWER);

    await expect(client.complete(REQUEST)).resolves.toMatchObject({ data: { score: 0.85 } });
    expect(run).toHaveBeenCalledTimes(2);

    const timedOut = { exitCode: null, stdout: '', stderr: '', timedOut: true };
    const slow = clientWith(timedOut, timedOut);
    await expect(slow.client.complete(REQUEST)).rejects.toThrow(
      'claude did not answer within 1000 ms',
    );
  });

  it.each([
    ['a missing CLI', new Error('spawn claude ENOENT'), 'The claude CLI could not be started'],
    ['output that is not JSON', { ...ANSWER, stdout: 'Hello' }, 'output that is not JSON'],
    [
      'an error result',
      printResult({ is_error: true, result: 'Credit balance too low' }),
      'claude reported an error: Credit balance too low',
    ],
    [
      'an error result with a non-zero exit',
      {
        exitCode: 1,
        stdout: JSON.stringify({ is_error: true, result: 'Not logged in' }),
        stderr: '',
        timedOut: false,
      },
      'claude reported an error: Not logged in',
    ],
    [
      'no structured output',
      printResult({ is_error: false, result: 'plain text' }),
      'claude answered without structured output',
    ],
  ])('fails without retrying on %s', async (_case, result, message) => {
    const { client, run, logger } = clientWith(result);

    await expect(client.complete(REQUEST)).rejects.toThrow(message);
    expect(run).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'claude-code', error: expect.stringContaining(message) }),
      'LLM call failed',
    );
  });

  it('is chosen per role in .env and needs a model but no API key', async () => {
    const config = loadLlmConfig({
      LLM_PROVIDER: 'fake',
      LLM_JUDGE_PROVIDER: 'claude-code',
      LLM_JUDGE_MODEL: 'claude-haiku-5-5',
    });
    const { run } = clientWith(ANSWER);

    const roles = createLlmRoles(config, { logger: createCapturingLogger(), runProcess: run });
    await roles.judge.judge('Sekretessavtal', { id: 'c1', text: 'Text' });

    expect(config.roles.judge).toEqual({ provider: 'claude-code', model: 'claude-haiku-5-5' });
    expect(run).toHaveBeenCalledOnce();
    expect(() => loadLlmConfig({ LLM_PROVIDER: 'claude-code' })).toThrow(
      'LLM_TAGGER_MODEL or LLM_MODEL is required because tagger uses provider claude-code',
    );
  });
});

describe('runProcess', () => {
  it('runs without API credentials in the temp directory and passes the input on stdin', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const script =
      'let input = "";process.stdin.on("data", (d) => (input += d)).on("end", () => ' +
      'console.log(JSON.stringify({ key: process.env.ANTHROPIC_API_KEY ?? null, cwd: process.cwd(), input })));';
    try {
      const result = await runProcess(process.execPath, ['-e', script], {
        input: 'Är texten relevant?',
        timeoutMs: 10_000,
      });

      expect(result).toMatchObject({ exitCode: 0, timedOut: false });
      expect(JSON.parse(result.stdout)).toEqual({
        key: null,
        cwd: realpathSync(tmpdir()),
        input: 'Är texten relevant?',
      });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('settles as timed out when the process does not finish in time', async () => {
    const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], {
      input: '',
      timeoutMs: 200,
    });

    expect(result).toMatchObject({ exitCode: null, timedOut: true });
  });
});
