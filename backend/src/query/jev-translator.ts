import { JevError, type JevClient, type JevQuestion } from '../jev/client.js';
import { sumUsage } from '../llm/client.js';
import { MAX_QUERY_TAGS } from '../llm/roles.js';
import type { QueryTranslator, Tag, TranslatedTag } from '../llm/types.js';
import { AREAS, groupByArea, type Area } from '../tagging/vocabulary.js';

/** At most this many areas are asked about tag by tag. */
const MAX_AREAS = 3;

const AREA_QUESTION = 'area';

type ScoredTag = Required<TranslatedTag>;

/** What the questions for one vocabulary need, built once per vocabulary. */
interface PreparedVocabulary {
  areaQuestion: JevQuestion;
  tagsByArea: Map<string, Tag[]>;
  tagQuestionsByArea: Map<string, Record<string, JevQuestion>>;
}

/**
 * Translates with JEV: the instruction is the state; a Choice question picks the areas it is about
 * (up to {@link MAX_AREAS}, by probability), then one Noul question per tag in those areas asks
 * "Handlar texten om <description>?", one call per area in parallel. Tags scoring at least
 * `threshold` are kept, highest score first, at most {@link MAX_QUERY_TAGS}.
 */
export function createJevQueryTranslator(client: JevClient, threshold: number): QueryTranslator {
  const prepared = new WeakMap<readonly Tag[], PreparedVocabulary>();
  const prepare = (vocabulary: readonly Tag[]) => {
    let entry = prepared.get(vocabulary);
    if (!entry) prepared.set(vocabulary, (entry = prepareVocabulary(vocabulary)));
    return entry;
  };

  return {
    async translate(instruction, vocabulary, { exclude } = {}) {
      const { areaQuestion, tagsByArea, tagQuestionsByArea } = prepare(vocabulary);
      const choice = await client.ask(instruction, { [AREA_QUESTION]: areaQuestion });
      const answer = choice.answers[AREA_QUESTION];
      // The client has checked each answer's type against its question; this narrows the type.
      if (answer.type !== 'choice') throw new JevError('response', 'Expected a choice answer');
      const areas = chosenAreas(answer.probabilities, answer.choice, tagsByArea);

      // When one area's call fails, the others are cancelled rather than left running and billed.
      const cancel = new AbortController();
      const perArea = await Promise.all(
        areas.map(async (area) => {
          const { answers, usage } = await client
            .ask(instruction, tagQuestionsByArea.get(area)!, cancel.signal)
            .catch((error: unknown) => {
              cancel.abort();
              throw error;
            });
          const scored = tagsByArea.get(area)!.map((tag): ScoredTag => {
            const tagAnswer = answers[tag.slug];
            if (tagAnswer.type !== 'noul') throw new JevError('response', 'Expected a noul answer');
            return { slug: tag.slug, score: tagAnswer.noul };
          });
          return { scored, usage };
        }),
      );
      const askedTags = perArea.flatMap((result) => result.scored);
      const tags = askedTags
        .filter((tag) => tag.score >= threshold && !exclude?.has(tag.slug))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_QUERY_TAGS);
      return {
        tags,
        areaScores: answer.probabilities,
        askedTags,
        usage: sumUsage([choice.usage, ...perArea.map((result) => result.usage)]),
      };
    },
  };
}

function prepareVocabulary(vocabulary: readonly Tag[]): PreparedVocabulary {
  const tagsByArea = groupByArea(vocabulary);
  const criteria = Object.fromEntries(
    [...tagsByArea.keys()].map((area) => [area, AREAS[area as Area] ?? area]),
  );
  const tagQuestionsByArea = new Map(
    [...tagsByArea].map(([area, tags]) => [
      area,
      Object.fromEntries(
        tags.map((tag): [string, JevQuestion] => [
          tag.slug,
          { type: 'noul', instructions: `Handlar texten om ${tag.description}?` },
        ]),
      ),
    ]),
  );
  return {
    areaQuestion: {
      type: 'choice',
      instructions: 'Vilket rättsområde handlar texten om?',
      criteria,
    },
    tagsByArea,
    tagQuestionsByArea,
  };
}

/** The areas with the highest probabilities, or the single chosen one when none are given. */
function chosenAreas(
  probabilities: Record<string, number>,
  choice: string,
  tagsByArea: Map<string, Tag[]>,
): string[] {
  const ranked = Object.entries(probabilities)
    .filter(([area, probability]) => tagsByArea.has(area) && probability > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([area]) => area);
  if (ranked.length > 0) return ranked.slice(0, MAX_AREAS);
  return tagsByArea.has(choice) ? [choice] : [];
}
