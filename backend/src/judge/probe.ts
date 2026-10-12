// `npm run jev:probe -w backend`: measures what the JEV documentation leaves out (open point "JEV
// limits"): latency per call, the largest state accepted and how a burst of concurrent calls is
// answered, with the judge's timeout (`JUDGE_TIMEOUT_MS`). Needs JEV_API_KEY; every call is billed
// by TypeSafe.

import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import { createJevClient, JevError, type JevClient } from '../jev/client.js';
import { loadJevConfig } from '../jev/config.js';
import { SILENT_LOGGER } from '../llm/client.js';
import { relevanceQuestion } from '../llm/judge-question.js';
import { percentile } from '../stats.js';
import { loadJudgeTimeoutMs } from './config.js';

const LATENCY_CALLS = 10;
const BURST_CALLS = 20;
const FIRST_STATE_CHARS = 1000;
// Far above any chunk (CHUNK_MAX_CHARS is 2000 by default); stops the doubling if JEV never refuses.
const MAX_STATE_CHARS = 256_000;

const SENTENCE =
  'Arbetstagaren får inte under anställningen eller därefter röja företagshemligheter. ';
const QUESTIONS = {
  relevant: {
    type: 'noul' as const,
    instructions: relevanceQuestion('sekretessavtal för en konsult'),
  },
};

try {
  const env = process.env;
  const config = loadJevConfig(env, 'jev:probe calls JEV', loadJudgeTimeoutMs(env));
  const client = createJevClient({ ...config, role: 'judge', logger: SILENT_LOGGER });
  console.log(
    `Probing ${config.baseUrl} with model ${config.model}, timeout ${config.timeoutMs} ms`,
  );
  // Each probe reports its own failure, so one failing call does not lose the other measurements.
  for (const probe of [probeLatency, probeStateSize, probeBurst]) {
    await probe(client).catch((error: unknown) => {
      console.error(`${probe.name} failed: ${describeError(error)}`);
      process.exitCode = 1;
    });
  }
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function probeLatency(client: JevClient): Promise<void> {
  const latencies: number[] = [];
  for (let i = 0; i < LATENCY_CALLS; i++) {
    const started = performance.now();
    await client.ask(stateOf(FIRST_STATE_CHARS), QUESTIONS);
    latencies.push(elapsedMs(started));
  }
  latencies.sort((a, b) => a - b);
  console.log(
    `Latency over ${LATENCY_CALLS} sequential calls: ` +
      `median ${percentile(latencies, 0.5)} ms, max ${latencies.at(-1)} ms`,
  );
}

/**
 * Doubles the state until JEV refuses it. Only a client error other than 429 counts as a refusal;
 * a timeout, rate limit, server or network error stops the probe without claiming a size limit.
 */
async function probeStateSize(client: JevClient): Promise<void> {
  let accepted = 0;
  for (let chars = FIRST_STATE_CHARS; chars <= MAX_STATE_CHARS; chars *= 2) {
    try {
      await client.ask(stateOf(chars), QUESTIONS);
      accepted = chars;
    } catch (error) {
      const verdict = isRefusal(error) ? 'refused' : 'not measured, the call failed';
      console.log(
        `State size: ${accepted} characters accepted; ${chars} ${verdict} (${describeError(error)})`,
      );
      return;
    }
  }
  console.log(`State size: ${accepted} characters accepted, no refusal up to the probe's cap`);
}

async function probeBurst(client: JevClient): Promise<void> {
  const started = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: BURST_CALLS }, () => client.ask(stateOf(FIRST_STATE_CHARS), QUESTIONS)),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  const rateLimited = failures.filter(
    (reason) => reason instanceof JevError && reason.status === 429,
  ).length;
  console.log(
    `Burst of ${BURST_CALLS} concurrent calls in ${elapsedMs(started)} ms: ` +
      `${BURST_CALLS - failures.length} answered, ${rateLimited} rate limited (HTTP 429), ` +
      `${failures.length - rateLimited} other errors`,
  );
}

/** Whether JEV turned the request down (4xx other than 429), as opposed to failing to answer. */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof JevError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

/** About `chars` characters of Swedish contract text. */
function stateOf(chars: number): string {
  return SENTENCE.repeat(Math.ceil(chars / SENTENCE.length)).slice(0, chars);
}
