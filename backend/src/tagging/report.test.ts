import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeTagger } from '../llm/fakes.js';
import { createCapturingLogger } from '../llm/test-helpers.js';
import { reportCommand, tagCommand } from './commands.js';
import { loadReportConfig } from './config.js';
import { buildReport, type TaggingReport } from './report.js';
import {
  formatReportAsMarkdown,
  formatReportForTerminal,
  TERMINAL_CHUNK_LIMIT,
  writeReport,
} from './report-format.js';
import { syncVocabulary } from './sync-vocabulary.js';
import { createTaggingWorkspace } from './test-helpers.js';
import { vocabularyVersion, type Vocabulary, type VocabularyTag } from './vocabulary.js';

const TAGS: VocabularyTag[] = [
  { slug: 'lon', label: 'Lön', description: 'lön', area: 'lon' },
  { slug: 'bonus', label: 'Bonus', description: 'bonus', area: 'lon' },
  { slug: 'vite', label: 'Vite', description: 'vite', area: 'skadestand' },
  { slug: 'semester', label: 'Semester', description: 'semester', area: 'semester' },
  { slug: 'ranta', label: 'Ränta', description: 'ränta', area: 'skadestand' },
];
const VOCABULARY: Vocabulary = {
  tags: TAGS,
  presets: { employment: [], nda: [] },
  version: vocabularyVersion(TAGS),
};
const MODEL = 'claude-haiku-5-5';
const OPTIONS = { vocabularyVersion: VOCABULARY.version, broadShare: 0.5 };

describe('tagging report', () => {
  let workspace: ReturnType<typeof createTaggingWorkspace>;
  let reportsDir: string;

  beforeEach(() => {
    workspace = createTaggingWorkspace();
    reportsDir = mkdtempSync(join(tmpdir(), 'reports-'));
    syncVocabulary(workspace.db, TAGS);
  });

  afterEach(() => {
    workspace.remove();
    rmSync(reportsDir, { recursive: true, force: true });
  });

  /** Gives the chunk these tags and marks it tagged with `version` (current by default). */
  function tagChunk(chunkId: number, slugs: string[], version = VOCABULARY.version) {
    const at = '2026-10-10T08:00:00.000Z';
    for (const slug of slugs) {
      workspace.db
        .prepare(
          `INSERT INTO chunk_tags (chunk_id, tag_id, model, vocabulary_version, created_at)
           SELECT ?, id, ?, ?, ? FROM tags WHERE slug = ?`,
        )
        .run(chunkId, MODEL, version, at, slug);
    }
    workspace.db
      .prepare(
        'UPDATE chunks SET tagged_model = ?, tagged_vocabulary_version = ?, tagged_at = ? WHERE id = ?',
      )
      .run(MODEL, version, at, chunkId);
  }

  function addRun(chunksTagged = 4, discardedSlugs = 7, finishedAt = '2026-10-10T08:00:00.000Z') {
    workspace.db
      .prepare(
        `INSERT INTO tagging_runs (started_at, finished_at, model, vocabulary_version,
           chunks_tagged, chunks_skipped, chunks_failed, discarded_slugs, chunks_below_min,
           chunks_above_max, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens,
           cost_usd)
         VALUES ('2026-10-10T07:59:00.000Z', ?, ?, ?, ?, 0, 0, ?, 3, 0, 100, 10, 0, 0, 0.0123)`,
      )
      .run(finishedAt, MODEL, VOCABULARY.version, chunksTagged, discardedSlugs);
  }

  /**
   * Six chunks: three tagged with tags, one tagged with zero tags, one never tagged, and one
   * tagged with an older vocabulary whose tag must not count.
   */
  function addFixture() {
    const ids = workspace.addChunks('SFS 1982:80', ['a', 'b', 'c', 'd', 'e', 'f']);
    tagChunk(ids[0], ['lon', 'bonus', 'vite']);
    tagChunk(ids[1], ['lon']);
    tagChunk(ids[2], []);
    tagChunk(ids[3], ['lon', 'semester']);
    tagChunk(ids[5], ['vite'], 'old-version');
    addRun();
    return ids;
  }

  describe('buildReport', () => {
    it('counts chunks per tag, including zero, most first, and marks broad tags', () => {
      addFixture();

      const report = buildReport(workspace.db, OPTIONS);

      expect(report.model).toBe(MODEL);
      expect(report.tags.map((tag) => [tag.slug, tag.chunks, tag.broad])).toEqual([
        ['lon', 3, true],
        ['bonus', 1, false],
        ['semester', 1, false],
        ['vite', 1, false],
        ['ranta', 0, false],
      ]);
      expect(report.tags[0]).toMatchObject({ label: 'Lön', area: 'lon', share: 1 });
      expect(report.tags[1].share).toBeCloseTo(1 / 3);
    });

    it('lists the tagged chunks that got zero tags', () => {
      const ids = addFixture();

      const report = buildReport(workspace.db, OPTIONS);

      expect(report.chunksWithoutTags).toEqual([{ id: ids[2], sourceRef: 'SFS 1982:80 3 §' }]);
    });

    it('summarises chunks, tags and the latest tagging run', () => {
      addFixture();

      const report = buildReport(workspace.db, OPTIONS);

      expect(report.summary).toEqual({
        totalChunks: 6,
        taggedChunks: 4,
        outdatedChunks: 2,
        chunksWithTags: 3,
        chunksBelowMin: 3,
        averageTags: 2,
        tagsWithoutChunks: 1,
        broadTags: 1,
      });
      expect(report.latestRun).toEqual({
        finishedAt: '2026-10-10T08:00:00.000Z',
        chunksTagged: 4,
        model: MODEL,
        vocabularyVersion: VOCABULARY.version,
        discardedSlugs: 7,
        costUsd: 0.0123,
      });
    });

    it('keeps the latest run that tagged chunks when a later run only skipped', () => {
      addFixture();
      addRun(0, 0, '2026-10-10T09:00:00.000Z');

      const report = buildReport(workspace.db, OPTIONS);

      expect(report.latestRun).toMatchObject({ chunksTagged: 4, discardedSlugs: 7 });
    });

    it('marks a tag broad only above the threshold', () => {
      addFixture();
      const broadSlugs = (broadShare: number) =>
        buildReport(workspace.db, { ...OPTIONS, broadShare })
          .tags.filter((tag) => tag.broad)
          .map((tag) => tag.slug);

      expect(broadSlugs(1 / 3)).toEqual(['lon']);
      expect(broadSlugs(0.3)).toEqual(['lon', 'bonus', 'semester', 'vite']);
    });

    it('reports an empty database without a tagging run', () => {
      workspace.addChunks('SFS 1982:80', ['a', 'b']);

      const report = buildReport(workspace.db, OPTIONS);

      expect(report.latestRun).toBeUndefined();
      expect(report.model).toBeUndefined();
      expect(report.summary).toMatchObject({
        totalChunks: 2,
        taggedChunks: 0,
        outdatedChunks: 2,
        averageTags: 0,
        tagsWithoutChunks: 5,
      });
      expect(report.tags.every((tag) => tag.share === 0 && !tag.broad)).toBe(true);
      expect(formatReportForTerminal(report)).toContain('latest tagging run: none yet');
      expect(formatReportForTerminal(report)).toContain('model none: no tagging run yet');
      expect(formatReportForTerminal(report)).toContain('Chunks without tags (0):\n  none');
    });
  });

  describe('formatting', () => {
    it('prints the summary, every tag with its count and the chunks without tags', () => {
      const ids = addFixture();

      const text = formatReportForTerminal(buildReport(workspace.db, OPTIONS));

      expect(text).toContain(
        'chunks: 6 in total, 4 tagged with this model and vocabulary, 2 not yet tagged or out of date',
      );
      expect(text).toContain('tagged chunks: 3 with tags, 1 without, 3 with fewer than 3');
      expect(text).toContain('average tags per chunk with tags: 2.0');
      expect(text).toContain('tags: 1 with no chunks, 1 broad');
      expect(text).toContain('7 discarded out-of-vocabulary slugs, estimated cost 0.0123 USD');
      expect(text).toContain('3  100%  lon – Lön [lon]  BROAD');
      expect(text).toContain('0    0%  ranta – Ränta [skadestand]');
      expect(text).toContain(`Chunks without tags (1):\n  #${ids[2]} SFS 1982:80 3 §`);
    });

    function reportWithZeroTagChunks(count: number): TaggingReport {
      const report = buildReport(workspace.db, OPTIONS);
      return {
        ...report,
        chunksWithoutTags: Array.from({ length: count }, (_, index) => ({
          id: index + 1,
          sourceRef: `SFS 1982:80 ${index + 1} §`,
        })),
      };
    }

    it(`shows at most ${TERMINAL_CHUNK_LIMIT} chunks without tags in the terminal`, () => {
      const text = formatReportForTerminal(reportWithZeroTagChunks(53));

      expect(text).toContain(`#${TERMINAL_CHUNK_LIMIT} SFS 1982:80 50 §`);
      expect(text).not.toContain('#51 ');
      expect(text).toContain('… and 3 more (see the report file)');
    });

    it('shows a share below half a percent as <1%, not as 0%', () => {
      const report = buildReport(workspace.db, OPTIONS);
      const tags = [{ ...report.tags[0], chunks: 1, share: 1 / 500 }];

      expect(formatReportForTerminal({ ...report, tags })).toContain(`1   <1%  ${tags[0].slug} –`);
    });

    it('escapes a pipe in a Markdown table cell', () => {
      const report = buildReport(workspace.db, OPTIONS);
      const tags = [{ ...report.tags[0], label: 'Lön | förmåner' }];

      expect(formatReportAsMarkdown({ ...report, tags })).toContain('| Lön \\| förmåner |');
    });

    it('lists every chunk without tags in the Markdown file', () => {
      const markdown = formatReportAsMarkdown(reportWithZeroTagChunks(53));

      expect(markdown).toContain('## Chunks without tags (53)');
      expect(markdown).toContain('- #53 SFS 1982:80 53 §');
      expect(markdown).toContain('| 0 | 0% | `ranta` | Ränta | skadestand |  |');
    });

    it('writes the report to a file named by UTC time', () => {
      addFixture();
      const report = buildReport(workspace.db, OPTIONS);

      const path = writeReport(report, reportsDir, new Date('2026-10-10T14:30:00.123Z'));

      expect(path).toBe(join(reportsDir, 'tagging-20261010T143000Z.md'));
      expect(readFileSync(path, 'utf8')).toBe(formatReportAsMarkdown(report));
    });

    it('does not overwrite a report written in the same second', () => {
      const report = buildReport(workspace.db, OPTIONS);
      const now = new Date('2026-10-10T14:30:00.000Z');

      const first = writeReport(report, reportsDir, now);
      const second = writeReport(report, reportsDir, now);

      expect(second).toBe(join(reportsDir, 'tagging-20261010T143000Z-2.md'));
      expect(readdirSync(reportsDir).sort()).toEqual(
        [first, second].map((path) => path.slice(reportsDir.length + 1)).sort(),
      );
    });
  });

  describe('commands', () => {
    it('index:tag prints the run summary and the report, and writes the report', async () => {
      workspace.addChunks('SFS 1982:80', ['Lön och bonus.', 'Inget ämne.']);
      const print = vi.fn();

      const exitCode = await tagCommand({
        db: workspace.db,
        tagger: createFakeTagger(),
        vocabulary: VOCABULARY,
        model: 'fake',
        concurrency: 2,
        logger: createCapturingLogger(),
        broadShare: 0.2,
        reportsDir,
        print,
      });

      expect(exitCode).toBe(0);
      const printed = print.mock.calls.map(([text]) => text as string);
      expect(printed[0]).toContain('chunks: tagged 2, skipped 0, failed 0');
      expect(printed[1]).toContain('Tagging report (model fake');
      expect(printed[1]).toContain('Chunks without tags (1):');
      const [file] = readdirSync(reportsDir);
      expect(printed[2]).toBe(`Report written to ${join(reportsDir, file)}`);
    });

    it('index:report syncs the vocabulary file before reporting', () => {
      const print = vi.fn();
      const extended = [
        ...TAGS,
        { slug: 'pension', label: 'Pension', description: 'pension', area: 'lon' as const },
      ];
      const vocabulary = { ...VOCABULARY, tags: extended, version: vocabularyVersion(extended) };

      reportCommand({ db: workspace.db, vocabulary, broadShare: 0.5, reportsDir, print });

      expect(print.mock.calls[0][0]).toContain('pension – Pension [lon]');
    });

    it('index:report reports the latest run without tagging', () => {
      addFixture();
      const print = vi.fn();

      const exitCode = reportCommand({
        db: workspace.db,
        vocabulary: VOCABULARY,
        broadShare: OPTIONS.broadShare,
        reportsDir,
        print,
      });

      expect(exitCode).toBe(0);
      expect(print.mock.calls[0][0]).toBe(
        formatReportForTerminal(buildReport(workspace.db, OPTIONS)),
      );
      expect(readdirSync(reportsDir)).toHaveLength(1);
    });
  });
});

describe('loadReportConfig', () => {
  it('defaults to a broad share of 0.2', () => {
    expect(loadReportConfig({})).toEqual({ broadShare: 0.2 });
  });

  it.each([
    ['0', 0],
    ['0.35', 0.35],
    ['1', 1],
  ])('reads TAG_REPORT_BROAD_SHARE=%j', (value, share) => {
    expect(loadReportConfig({ TAG_REPORT_BROAD_SHARE: value })).toEqual({ broadShare: share });
  });

  it.each(['1.5', '-0.1', '20%', '1e-1', 'x'])('rejects TAG_REPORT_BROAD_SHARE=%j', (value) => {
    expect(() => loadReportConfig({ TAG_REPORT_BROAD_SHARE: value })).toThrow(
      `Invalid TAG_REPORT_BROAD_SHARE "${value}": expected a number from 0 to 1`,
    );
  });
});
