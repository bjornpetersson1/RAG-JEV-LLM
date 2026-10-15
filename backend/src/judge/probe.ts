// `npm run jev:probe` and `npm run subq:probe [-- --yes]`: measure what the JEV and SubQ
// documentation leaves out (open points "JEV limits" and "SubQ limits"): latency per call, the
// largest state accepted and how a burst of concurrent calls is answered, with the judge's timeout
// (`JUDGE_TIMEOUT_MS`). Needs JEV_API_KEY or SUBQ_API_KEY; every call is billed. SubQ's probe first
// prints what it will cost at most and asks to go on (E9-1).

import { describeError } from '../errors.js';
import { elapsedMs } from '../http.js';
import { SILENT_LOGGER } from '../llm/client.js';
import { relevanceQuestion } from '../llm/judge-question.js';
import { percentile } from '../stats.js';
import {
  createSystemOneClient,
  SystemOneError,
  type SystemOneClient,
} from '../systemone/client.js';
import { loadSystemOneConfig, PROVIDER_NAMES, SYSTEM_ONE_PROVIDERS } from '../systemone/config.js';
import {
  addCalls,
  callsOf,
  confirmPaidRun,
  estimateCost,
  formatUsage,
  meterSubqUsage,
} from '../systemone/paid-run.js';
import { isOneOf } from '../env.js';
import { loadJudgeTimeoutMs } from './config.js';

const LATENCY_CALLS = 10;
const BURST_CALLS = 20;
const FIRST_STATE_CHARS = 1000;
// Far above any chunk (CHUNK_MAX_CHARS is 2000 by default); stops the doubling if nothing is refused.
const MAX_STATE_CHARS = 256_000;

const SENTENCE =
  'Arbetstagaren får inte under anställningen eller därefter röja företagshemligheter. ';
const QUESTIONS = {
  relevant: {
    type: 'noul' as const,
    instructions: relevanceQuestion('sekretessavtal för en konsult'),
  },
};

const USAGE = 'Usage: probe <jev | subq> [--yes]';

try {
  process.exitCode = await probe(process.argv.slice(2));
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}

async function probe(args: string[]): Promise<number> {
  const [provider, ...flags] = args;
  if (!isOneOf(SYSTEM_ONE_PROVIDERS, provider) || flags.some((flag) => flag !== '--yes')) {
    console.error(USAGE);
    return 1;
  }
  const env = process.env;
  const config = loadSystemOneConfig(
    env,
    provider,
    `${provider}:probe calls ${PROVIDER_NAMES[provider]}`,
    loadJudgeTimeoutMs(env),
  );
  const meter = meterSubqUsage(SILENT_LOGGER);
  if (
    provider === 'subq' &&
    !(await confirmPaidRun(estimateCost(probeCalls()), { yes: flags.includes('--yes') }))
  ) {
    return 1;
  }
  const client = createSystemOneClient({
    ...config,
    provider,
    role: 'judge',
    logger: meter.logger,
  });
  console.log(
    `Probing ${config.baseUrl} with model ${config.model}, timeout ${config.timeoutMs} ms`,
  );
  let exitCode = 0;
  // Each probe reports its own failure, so one failing call does not lose the other measurements.
  for (const measure of [probeLatency, probeStateSize, probeBurst]) {
    await measure(client).catch((error: unknown) => {
      console.error(`${measure.name} failed: ${describeError(error)}`);
      exitCode = 1;
    });
  }
  if (provider === 'subq') console.log(formatUsage(meter.used()));
  return exitCode;
}

/** The probe's calls at most: every state size accepted up to the cap. */
function probeCalls() {
  const question = QUESTIONS.relevant.instructions.length;
  const sizes: number[] = [];
  for (let chars = FIRST_STATE_CHARS; chars <= MAX_STATE_CHARS; chars *= 2) sizes.push(chars);
  return addCalls(
    callsOf(LATENCY_CALLS, FIRST_STATE_CHARS + question),
    ...sizes.map((chars) => callsOf(1, chars + question)),
    callsOf(BURST_CALLS, FIRST_STATE_CHARS + question),
  );
}

async function probeLatency(client: SystemOneClient): Promise<void> {
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
 * Doubles the state until the model refuses it. Only a client error other than 429 counts as a
 * refusal; a timeout, rate limit, server or network error stops the probe without claiming a size
 * limit.
 */
async function probeStateSize(client: SystemOneClient): Promise<void> {
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

async function probeBurst(client: SystemOneClient): Promise<void> {
  const started = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: BURST_CALLS }, () => client.ask(stateOf(FIRST_STATE_CHARS), QUESTIONS)),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  const rateLimited = failures.filter(
    (reason) => reason instanceof SystemOneError && reason.status === 429,
  ).length;
  console.log(
    `Burst of ${BURST_CALLS} concurrent calls in ${elapsedMs(started)} ms: ` +
      `${BURST_CALLS - failures.length} answered, ${rateLimited} rate limited (HTTP 429), ` +
      `${failures.length - rateLimited} other errors`,
  );
}

/** Whether the model turned the request down (4xx other than 429), as opposed to failing to answer. */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof SystemOneError &&
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
