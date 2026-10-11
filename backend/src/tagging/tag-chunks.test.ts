import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmError, NO_USAGE } from '../llm/client.js';
import { createFakeTagger } from '../llm/fakes.js';
import { createCapturingLogger } from '../llm/test-helpers.js';
import type { Tagger, TaggingInput, TaggingResult } from '../llm/types.js';
import { tagChunks, type TagChunksOptions } from './tag-chunks.js';
import { createTaggingWorkspace } from './test-helpers.js';
import { vocabularyVersion, type Vocabulary, type VocabularyTag } from './vocabulary.js';

const TAGS: VocabularyTag[] = [
  { slug: 'lon', label: 'Lön', description: 'lön', area: 'lon' },
  { slug: 'bonus', label: 'Bonus', description: 'bonus', area: 'lon' },
  { slug: 'vite', label: 'Vite', description: 'vite', area: 'skadestand' },
  { slug: 'semester', label: 'Semester', description: 'semester', area: 'semester' },
];

function vocabularyOf(tags: VocabularyTag[]): Vocabulary {
  return { tags, presets: { employment: [], nda: [] }, version: vocabularyVersion(tags) };
}

const VOCABULARY = vocabularyOf(TAGS);

const TEXTS = [
  'Lön och bonus betalas ut månadsvis.',
  'Vite ska betalas vid brott mot avtalet.',
  'Semester och lön under semestern.',
  'En paragraf utan ämne.',
];

/** The fake tagger's default (labels found in the text), recording which chunks it was asked about. */
function recordingTagger(fail: (chunk: TaggingInput) => boolean = () => false) {
  const fake = createFakeTagger();
  const asked: string[] = [];
  const tagger: Tagger = {
    async tag(chunk, vocabulary) {
      asked.push(chunk.text);
      if (fail(chunk)) throw new Error('model unavailable');
      return fake.tag(chunk, vocabulary);
    },
  };
  return { tagger, asked };
}

describe('tagChunks', () => {
  let workspace: ReturnType<typeof createTaggingWorkspace>;
  let chunkIds: number[];
  let logger: ReturnType<typeof createCapturingLogger>;

  beforeEach(() => {
    workspace = createTaggingWorkspace();
    chunkIds = workspace.addChunks('SFS 1982:80', TEXTS);
    logger = createCapturingLogger();
  });

  afterEach(() => {
    workspace.remove();
  });

  const run = (options: Partial<TagChunksOptions> = {}) =>
    tagChunks({
      db: workspace.db,
      tagger: recordingTagger().tagger,
      vocabulary: VOCABULARY,
      model: 'fake',
      concurrency: 2,
      logger,
      ...options,
    });

  const chunkTags = () =>
    workspace.db
      .prepare(
        `SELECT ct.chunk_id, t.slug, ct.model, ct.vocabulary_version
         FROM chunk_tags ct JOIN tags t ON t.id = ct.tag_id ORDER BY ct.chunk_id, t.slug`,
      )
      .all();

  const taggingState = () =>
    workspace.db
      .prepare('SELECT id, tagged_model, tagged_vocabulary_version FROM chunks ORDER BY id')
      .all();

  it('tags every chunk and records the model and vocabulary version', async () => {
    const summary = await run();

    expect(summary).toMatchObject({ tagged: 4, skipped: 0, failed: 0, remaining: 0 });
    expect(chunkTags().map((row) => [row.chunk_id, row.slug])).toEqual([
      [chunkIds[0], 'bonus'],
      [chunkIds[0], 'lon'],
      [chunkIds[1], 'vite'],
      [chunkIds[2], 'lon'],
      [chunkIds[2], 'semester'],
    ]);
    expect(chunkTags().every((row) => row.vocabulary_version === VOCABULARY.version)).toBe(true);
    expect(taggingState()).toEqual(
      chunkIds.map((id) => ({
        id,
        tagged_model: 'fake',
        tagged_vocabulary_version: VOCABULARY.version,
      })),
    );
  });

  it('syncs the vocabulary into the tags table first', async () => {
    await run();

    expect(workspace.db.prepare('SELECT slug FROM tags ORDER BY slug').all()).toEqual(
      ['bonus', 'lon', 'semester', 'vite'].map((slug) => ({ slug })),
    );
  });

  it('skips every chunk on a second run, including one that got zero tags', async () => {
    await run();
    const before = chunkTags();
    const { tagger, asked } = recordingTagger();

    const summary = await run({ tagger });

    expect(asked).toEqual([]);
    expect(summary).toMatchObject({ tagged: 0, skipped: 4, failed: 0 });
    expect(chunkTags()).toEqual(before);
  });

  it('re-tags every chunk when the vocabulary version or the model changes', async () => {
    await run();
    const changed = vocabularyOf(TAGS.map((tag) => ({ ...tag, description: `${tag.label}.` })));

    const afterVocabulary = recordingTagger();
    await run({ tagger: afterVocabulary.tagger, vocabulary: changed });
    const afterModel = recordingTagger();
    await run({ tagger: afterModel.tagger, vocabulary: changed, model: 'claude-haiku-5-5' });

    expect(afterVocabulary.asked).toHaveLength(4);
    expect(afterModel.asked).toHaveLength(4);
    expect(new Set(chunkTags().map((row) => row.model))).toEqual(new Set(['claude-haiku-5-5']));
    expect(chunkTags()).toHaveLength(5);
  });

  it('re-tags every chunk with --force without creating duplicates', async () => {
    await run();
    const before = chunkTags();
    const { tagger, asked } = recordingTagger();

    const summary = await run({ tagger, force: true });

    expect(asked).toHaveLength(4);
    expect(summary).toMatchObject({ tagged: 4, skipped: 0 });
    expect(chunkTags()).toEqual(before);
  });

  it('replaces the tags of a re-tagged chunk', async () => {
    await run();
    const tagger = createFakeTagger(() => ['vite']);

    await run({ tagger, force: true });

    expect(chunkTags().map((row) => [row.chunk_id, row.slug])).toEqual(
      chunkIds.map((id) => [id, 'vite']),
    );
  });

  it('logs a failing chunk, keeps going, and tags it on the next run', async () => {
    const failing = recordingTagger((chunk) => chunk.text.startsWith('Vite'));

    const summary = await run({ tagger: failing.tagger });

    expect(summary).toMatchObject({ tagged: 3, failed: 1 });
    expect(failing.asked).toHaveLength(4);
    expect(logger.error).toHaveBeenCalledWith(
      { chunkId: chunkIds[1], sourceRef: 'SFS 1982:80 2 §', error: 'model unavailable' },
      'Tagging chunk failed',
    );
    expect(taggingState()[1]).toMatchObject({ tagged_model: null });

    const retry = recordingTagger();
    await run({ tagger: retry.tagger });

    expect(retry.asked).toEqual([TEXTS[1]]);
  });

  it('fails a chunk the tagger answers with a tag outside the vocabulary', async () => {
    const summary = await run({ tagger: createFakeTagger(() => ['lon', 'okand']) });

    expect(summary).toMatchObject({ tagged: 0, failed: 4 });
    expect(chunkTags()).toEqual([]);
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      error: 'The tagger returned an unknown tag "okand"',
    });
  });

  it('stores a slug the tagger repeats once', async () => {
    await run({ tagger: createFakeTagger(() => ['lon', 'lon']) });

    expect(chunkTags().map((row) => [row.chunk_id, row.slug])).toEqual(
      chunkIds.map((id) => [id, 'lon']),
    );
  });

  it('works through the corpus with repeated --force --limit runs', async () => {
    await run();
    // Runs within one millisecond would otherwise give every chunk the same tagging time.
    workspace.db.prepare("UPDATE chunks SET tagged_at = '2026-01-01T00:00:00.000Z'").run();
    const first = recordingTagger();
    const second = recordingTagger();

    await run({ tagger: first.tagger, force: true, limit: 2 });
    await run({ tagger: second.tagger, force: true, limit: 2 });

    expect(first.asked).toEqual(TEXTS.slice(0, 2));
    expect(second.asked).toEqual(TEXTS.slice(2));
  });

  it('counts the tokens of a failed chunk in the summary', async () => {
    const usage = { ...NO_USAGE, inputTokens: 300, cacheWriteTokens: 7000 };
    const tagger: Tagger = {
      async tag() {
        throw new LlmError('Anthropic API returned 529', { retryable: true, usage });
      },
    };

    const summary = await run({ tagger });

    expect(summary).toMatchObject({
      failed: 4,
      usage: { ...NO_USAGE, inputTokens: 1200, cacheWriteTokens: 28000 },
    });
  });

  it('tags at most --limit chunks, and the next run resumes with the rest', async () => {
    const first = recordingTagger();
    const summary = await run({ tagger: first.tagger, limit: 2 });

    expect(summary).toMatchObject({ tagged: 2, skipped: 0, remaining: 2 });

    const second = recordingTagger();
    await run({ tagger: second.tagger });

    expect(first.asked).toEqual(TEXTS.slice(0, 2));
    expect(second.asked).toEqual(TEXTS.slice(2));
  });

  it('tags the first chunk alone, then at most `concurrency` chunks at the same time', async () => {
    const fake = createFakeTagger(() => []);
    const inFlightAtStart: number[] = [];
    let inFlight = 0;
    const tagger: Tagger = {
      async tag(chunk, vocabulary) {
        inFlightAtStart.push(inFlight);
        inFlight += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return fake.tag(chunk, vocabulary);
      },
    };
    workspace.addChunks('SFS 1977:480', ['Ett.', 'Två.', 'Tre.']);

    await run({ tagger, concurrency: 3 });

    // The second call starts only after the first has finished (and warmed the prompt cache).
    expect(inFlightAtStart.slice(0, 2)).toEqual([0, 0]);
    expect(Math.max(...inFlightAtStart)).toBe(2);
  });

  describe('summary and cost', () => {
    const USAGE = {
      inputTokens: 500,
      outputTokens: 40,
      cacheWriteTokens: 0,
      cacheReadTokens: 6000,
    };

    // Per chunk, in order: 2 discarded slugs; cut to 8; fewer than 3 after a retry; a normal answer.
    const ANSWERS: Omit<TaggingResult, 'usage'>[] = [
      { tags: ['lon', 'bonus', 'vite'], discarded: ['x', 'y'], overLimit: [], retried: false },
      { tags: ['lon', 'bonus', 'vite'], discarded: [], overLimit: ['semester'], retried: false },
      { tags: ['semester'], discarded: [], overLimit: [], retried: true },
      { tags: ['lon', 'bonus', 'semester'], discarded: [], overLimit: [], retried: false },
    ];

    const scriptedTagger: Tagger = {
      tag: async (chunk) => ({ ...ANSWERS[TEXTS.indexOf(chunk.text)], usage: USAGE }),
    };

    it('logs each chunk with its tags, discarded slugs, tokens and cost', async () => {
      await run({ tagger: scriptedTagger, model: 'claude-haiku-5-5' });

      const entry = logger.info.mock.calls.find(([logged]) => logged.chunkId === chunkIds[0]);
      expect(entry).toEqual([
        {
          chunkId: chunkIds[0],
          sourceRef: 'SFS 1982:80 1 §',
          tags: ['lon', 'bonus', 'vite'],
          discarded: ['x', 'y'],
          overLimit: [],
          retried: false,
          belowMin: false,
          ...USAGE,
          costUsd: expect.closeTo((500 * 0.1 + 6000 * 0.01 + 40 * 0.5) / 1_000_000, 12),
        },
        'Tagged chunk',
      ]);
      const shortEntry = logger.info.mock.calls.find(([logged]) => logged.chunkId === chunkIds[2]);
      expect(shortEntry?.[0]).toMatchObject({ belowMin: true, retried: true });
    });

    it('sums the run and stores it in tagging_runs', async () => {
      const summary = await run({ tagger: scriptedTagger, model: 'claude-haiku-5-5' });

      const totalUsage = {
        inputTokens: 2000,
        outputTokens: 160,
        cacheWriteTokens: 0,
        cacheReadTokens: 24000,
      };
      const costUsd = (2000 * 0.1 + 24000 * 0.01 + 160 * 0.5) / 1_000_000;
      expect(summary).toMatchObject({
        model: 'claude-haiku-5-5',
        vocabularyVersion: VOCABULARY.version,
        tagged: 4,
        skipped: 0,
        failed: 0,
        discardedSlugs: 2,
        belowMin: 1,
        aboveMax: 1,
        usage: totalUsage,
      });
      expect(summary.costUsd).toBeCloseTo(costUsd, 12);

      const row = workspace.db.prepare('SELECT * FROM tagging_runs').get() as Record<
        string,
        unknown
      >;
      expect(row).toMatchObject({
        started_at: summary.startedAt,
        finished_at: summary.finishedAt,
        model: 'claude-haiku-5-5',
        vocabulary_version: VOCABULARY.version,
        chunks_tagged: 4,
        chunks_skipped: 0,
        chunks_failed: 0,
        discarded_slugs: 2,
        chunks_below_min: 1,
        chunks_above_max: 1,
        input_tokens: 2000,
        output_tokens: 160,
        cache_write_tokens: 0,
        cache_read_tokens: 24000,
      });
      expect(row.cost_usd).toBeCloseTo(costUsd, 12);
    });

    it('sums per-chunk costs, so the long-prompt rate is not applied to the whole run', async () => {
      // 60,000 cached prompt tokens per chunk: each below Haiku's 100,000 long-prompt threshold,
      // all four together above it.
      const usage = { ...NO_USAGE, cacheReadTokens: 60_000 };
      const tagger: Tagger = {
        tag: async (chunk) => ({ ...ANSWERS[TEXTS.indexOf(chunk.text)], usage }),
      };

      const summary = await run({ tagger, model: 'claude-haiku-5-5' });

      expect(summary.usage.cacheReadTokens).toBe(240_000);
      expect(summary.costUsd).toBeCloseTo((4 * 60_000 * 0.01) / 1_000_000, 12);
    });

    it('stores no cost for a model without a price', async () => {
      await run({ tagger: scriptedTagger });

      expect(workspace.db.prepare('SELECT cost_usd FROM tagging_runs').get()).toEqual({
        cost_usd: null,
      });
    });
  });
});
