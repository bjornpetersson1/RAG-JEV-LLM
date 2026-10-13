import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  LlmConfigError,
  loadLlmConfig,
} from './config.js';

const VALID = { LLM_PROVIDER: 'anthropic', LLM_MODEL: 'model-a', ANTHROPIC_API_KEY: 'key' };

function issuesFor(env: Record<string, string | undefined>): string[] {
  try {
    loadLlmConfig(env);
  } catch (error) {
    if (error instanceof LlmConfigError) return error.issues;
    throw error;
  }
  throw new Error('expected loadLlmConfig to throw');
}

describe('loadLlmConfig', () => {
  it('applies the default provider to every role, and the default model to all but the judge (Haiku)', () => {
    const config = loadLlmConfig(VALID);

    const anthropic = { provider: 'anthropic', model: 'model-a', apiKey: 'key' };
    expect(config).toEqual({
      roles: {
        tagger: anthropic,
        queryTranslator: anthropic,
        judge: { ...anthropic, model: 'claude-haiku-5-5' },
        generator: anthropic,
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
    });
  });

  it('applies per-role overrides of provider and model', () => {
    const config = loadLlmConfig({
      ...VALID,
      LLM_GENERATOR_MODEL: 'model-b',
      LLM_JUDGE_PROVIDER: 'fake',
      LLM_TIMEOUT_MS: '5000',
      LLM_MAX_RETRIES: '0',
    });

    expect(config.roles.tagger).toEqual({ provider: 'anthropic', model: 'model-a', apiKey: 'key' });
    expect(config.roles.generator).toEqual({
      provider: 'anthropic',
      model: 'model-b',
      apiKey: 'key',
    });
    expect(config.roles.judge).toEqual({ provider: 'fake' });
    expect(config.timeoutMs).toBe(5000);
    expect(config.maxRetries).toBe(0);
  });

  it('needs neither model nor API key when every role is fake', () => {
    const config = loadLlmConfig({ LLM_PROVIDER: 'fake' });

    expect(Object.values(config.roles)).toEqual(Array(4).fill({ provider: 'fake' }));
  });

  it('treats empty values as unset', () => {
    const config = loadLlmConfig({ ...VALID, LLM_TAGGER_PROVIDER: '', LLM_TAGGER_MODEL: ' ' });

    expect(config.roles.tagger).toEqual({ provider: 'anthropic', model: 'model-a', apiKey: 'key' });
  });

  it('reports a missing LLM_PROVIDER', () => {
    expect(issuesFor({})).toEqual([
      'LLM_PROVIDER is required (expected one of: anthropic, claude-code, fake)',
    ]);
  });

  it('reports an unknown default provider', () => {
    expect(issuesFor({ ...VALID, LLM_PROVIDER: 'openai' })).toEqual([
      'LLM_PROVIDER "openai" is not supported (expected one of: anthropic, claude-code, fake)',
    ]);
  });

  it('reports an unknown per-role provider', () => {
    expect(issuesFor({ ...VALID, LLM_QUERY_TRANSLATOR_PROVIDER: 'jev' })).toEqual([
      'LLM_QUERY_TRANSLATOR_PROVIDER "jev" is not supported (expected one of: anthropic, claude-code, fake)',
    ]);
  });

  it('reports an anthropic role without a model', () => {
    expect(
      issuesFor({
        LLM_PROVIDER: 'fake',
        LLM_TAGGER_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'key',
      }),
    ).toEqual(['LLM_TAGGER_MODEL or LLM_MODEL is required because tagger uses provider anthropic']);
  });

  it('reports a missing API key and names the roles that need it', () => {
    expect(
      issuesFor({ LLM_PROVIDER: 'fake', LLM_MODEL: 'model-a', LLM_JUDGE_PROVIDER: 'anthropic' }),
    ).toEqual(['ANTHROPIC_API_KEY is required because judge use provider anthropic']);
  });

  it.each(['0', '-1', '1.5', 'soon', '3000000000'])(
    'reports an invalid LLM_TIMEOUT_MS "%s"',
    (value) => {
      expect(issuesFor({ ...VALID, LLM_TIMEOUT_MS: value })).toEqual([
        `LLM_TIMEOUT_MS must be an integer from 1 to 2147483647, got "${value}"`,
      ]);
    },
  );

  it.each(['-1', '1.5', 'many', '11'])('reports an invalid LLM_MAX_RETRIES "%s"', (value) => {
    expect(issuesFor({ ...VALID, LLM_MAX_RETRIES: value })).toEqual([
      `LLM_MAX_RETRIES must be an integer from 0 to 10, got "${value}"`,
    ]);
  });

  it('reports every problem at once in a readable message', () => {
    const env = { LLM_PROVIDER: 'anthropic', LLM_TIMEOUT_MS: 'x' };

    // Every role but the judge, which has a default model, misses one.
    expect(issuesFor(env)).toHaveLength(5);
    expect(() => loadLlmConfig(env)).toThrow(
      /^Invalid LLM configuration in \.env:\n {2}- LLM_TAGGER_MODEL or LLM_MODEL is required/,
    );
  });
});
