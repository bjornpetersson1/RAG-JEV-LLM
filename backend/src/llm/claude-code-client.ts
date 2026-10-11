// The `claude-code` provider: runs the local `claude` CLI in print mode, so LLM roles run on the
// owner's Claude Code subscription instead of the paid API (E5-3). Much slower than the API, so
// it is meant for evaluation runs, not for timing.

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { describeError } from '../errors.js';
import {
  LlmError,
  toLlmUsage,
  type ApiUsage,
  type LlmClient,
  type LlmLogger,
  type LlmRequest,
  type LlmResponse,
} from './client.js';
import { withRetryAndLogging } from './retrying-client.js';
import type { RoleName } from './types.js';

export interface ProcessResult {
  /** Null when the process was killed. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Runs `command` with `args`, writing `input` to its stdin; rejects only when it cannot start. */
export type RunProcess = (
  command: string,
  args: readonly string[],
  options: { input: string; timeoutMs: number },
) => Promise<ProcessResult>;

export interface ClaudeCodeClientOptions {
  role: RoleName;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  logger: LlmLogger;
  run?: RunProcess;
  sleep?: (ms: number) => Promise<void>;
}

const COMMAND = 'claude';

interface PrintResult {
  is_error?: unknown;
  result?: unknown;
  structured_output?: unknown;
  usage?: ApiUsage;
}

export function createClaudeCodeClient(options: ClaudeCodeClientOptions): LlmClient {
  const { model, timeoutMs } = options;
  const run = options.run ?? runProcess;

  async function attempt(request: LlmRequest): Promise<LlmResponse> {
    // No tools, no saved session and no settings files: one structured answer to one prompt.
    const args = [
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(request.schema),
      '--system-prompt',
      request.system,
      '--model',
      model,
      '--tools',
      '',
      '--no-session-persistence',
      '--setting-sources',
      '',
    ];
    let result: ProcessResult;
    try {
      result = await run(COMMAND, args, { input: request.prompt, timeoutMs });
    } catch (error) {
      throw new LlmError(
        `The claude CLI could not be started (${describeError(error)}); install Claude Code or choose another provider`,
        { retryable: false },
      );
    }
    if (result.timedOut) {
      throw new LlmError(`claude did not answer within ${timeoutMs} ms`, { retryable: true });
    }
    if (result.exitCode !== 0) {
      // An error result (not logged in, unknown model, usage limit) will not change on a retry;
      // an exit without one (a crash, a dropped connection) may.
      const reported = reportedError(result.stdout);
      throw new LlmError(
        reported ??
          `claude exited with code ${result.exitCode}: ${(result.stderr || result.stdout).trim().slice(0, 300)}`,
        { retryable: reported === undefined },
      );
    }
    return parsePrintResult(result.stdout);
  }

  return withRetryAndLogging(attempt, {
    role: options.role,
    provider: 'claude-code',
    model,
    maxRetries: options.maxRetries,
    logger: options.logger,
    sleep: options.sleep,
    // The calls run on the Claude Code subscription, so API prices would overstate the spend.
    priced: false,
  });
}

function parsePrintResult(stdout: string): LlmResponse {
  const body = parseJson(stdout);
  if (body === undefined) {
    throw new LlmError('claude answered with output that is not JSON', { retryable: false });
  }
  const reported = reportedError(stdout);
  if (reported) throw new LlmError(reported, { retryable: false });
  if (typeof body.structured_output !== 'object' || body.structured_output === null) {
    throw new LlmError('claude answered without structured output', { retryable: false });
  }
  return { data: body.structured_output, usage: toLlmUsage(body.usage) };
}

/** The error message of a print-mode error result, if `stdout` is one. */
function reportedError(stdout: string): string | undefined {
  const body = parseJson(stdout);
  return body?.is_error === true
    ? `claude reported an error: ${String(body.result).slice(0, 300)}`
    : undefined;
}

function parseJson(text: string): PrintResult | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as PrintResult) : undefined;
  } catch {
    return undefined;
  }
}

// An API key in the environment takes precedence over the Claude Code login and would bill the API.
const API_CREDENTIALS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];

// How long a process that ignores SIGTERM gets before it is killed outright.
const KILL_GRACE_MS = 5000;

/**
 * The real process runner. The CLI runs without API credentials, so it uses the subscription, and
 * in the system temp directory, so no project instructions (CLAUDE.md) reach the prompt. At
 * `timeoutMs` the process is terminated and the call settles at once as timed out.
 */
export const runProcess: RunProcess = (command, args, { input, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !API_CREDENTIALS.includes(key)),
    );
    const child = spawn(command, args, { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (data: string) => (stdout += data));
    child.stderr.setEncoding('utf8').on('data', (data: string) => (stderr += data));
    // A process that exits before reading its input breaks the pipe; its exit code tells why.
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut: false });
    });
    child.stdin.end(input);
  });
