-- Tagging state per chunk, so a re-run can skip chunks already tagged with the current model and
-- vocabulary (also those that got no tags), and a summary row per tagging run for the report.

ALTER TABLE chunks ADD COLUMN tagged_model TEXT;
ALTER TABLE chunks ADD COLUMN tagged_vocabulary_version TEXT;
ALTER TABLE chunks ADD COLUMN tagged_at TEXT;

CREATE TABLE tagging_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  model TEXT NOT NULL,
  vocabulary_version TEXT NOT NULL,
  chunks_tagged INTEGER NOT NULL,
  chunks_skipped INTEGER NOT NULL,
  chunks_failed INTEGER NOT NULL,
  -- Slugs the model returned that are not in the vocabulary, summed over the tagged chunks.
  discarded_slugs INTEGER NOT NULL,
  -- Tagged chunks that ended with fewer than 3 tags, and chunks whose answer was cut to 8.
  chunks_below_min INTEGER NOT NULL,
  chunks_above_max INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  -- NULL when the model is not in the price table (or is the fake).
  cost_usd REAL
);
