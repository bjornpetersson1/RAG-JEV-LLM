import type { LlmUsage } from '../llm/client.js';
import type { QueryTranslator, Tag, TranslatedTag } from '../llm/types.js';
import { elapsedMs } from '../http.js';
import { isTemplate, TEMPLATES, type Template } from '../tagging/vocabulary.js';

export interface QueryInput {
  /** The lawyer's free text; may be empty when a template is chosen. */
  instruction: string;
  template?: string;
}

export interface QueryTag extends TranslatedTag {
  /** `preset` for a template's preset tag, `translated` for one the translator chose. */
  origin: 'preset' | 'translated';
}

export interface QueryTags {
  /** The template's presets first, then translated tags not among them. */
  tags: QueryTag[];
  /** From the translator, for the UI: JEV's area scores and every tag it scored. */
  areaScores?: Record<string, number>;
  askedTags?: TranslatedTag[];
  /** The tokens the translation used, when the translator reports them. */
  usage?: LlmUsage;
  elapsedMs: number;
}

export interface TranslationContext {
  translator: QueryTranslator;
  vocabulary: readonly Tag[];
  presets: Record<Template, readonly string[]>;
}

/**
 * The tags for a query: a template's preset tags, merged with the tags the translator gives for the
 * free text. Without free text the translator is not called: a template gives its presets alone,
 * and no template gives no tags. The translator's cap counts only tags that are not presets.
 */
export async function translateQuery(
  { instruction, template }: QueryInput,
  { translator, vocabulary, presets }: TranslationContext,
): Promise<QueryTags> {
  const started = performance.now();
  const presetSlugs = template === undefined ? [] : presetsOf(template, presets);
  const presetTags: QueryTag[] = presetSlugs.map((slug) => ({ slug, origin: 'preset' }));
  if (instruction.trim() === '') return { tags: presetTags, elapsedMs: elapsedMs(started) };

  const translation = await translator.translate(instruction, vocabulary, {
    exclude: new Set(presetSlugs),
  });
  const translated: QueryTag[] = translation.tags.map((tag) => ({ ...tag, origin: 'translated' }));
  return {
    tags: [...presetTags, ...translated],
    areaScores: translation.areaScores,
    askedTags: translation.askedTags,
    usage: translation.usage,
    elapsedMs: elapsedMs(started),
  };
}

function presetsOf(
  template: string,
  presets: Record<Template, readonly string[]>,
): readonly string[] {
  if (!isTemplate(template)) {
    throw new Error(`Unknown template "${template}": expected ${TEMPLATES.join(' or ')}`);
  }
  return presets[template];
}
