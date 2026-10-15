import {
  SystemOneError,
  type SystemOneClient,
  type SystemOneQuestion,
} from '../systemone/client.js';
import { sumUsage } from '../llm/client.js';
import { memoizeByIdentity } from '../memo.js';
import { MAX_QUERY_TAGS } from '../llm/roles.js';
import type { QueryTranslator, Tag, TranslatedTag } from '../llm/types.js';
import { AREAS, groupByArea, type Area } from '../tagging/vocabulary.js';

/** At most this many areas are asked about tag by tag. */
export const MAX_AREAS = 3;

/** At most this many questions per call: SubQ's limit (docs.subq.ai/endpoints/decisions-api). */
export const MAX_QUESTIONS_PER_CALL = 16;

const AREA_QUESTION = 'area';

type ScoredTag = Required<TranslatedTag>;

/** What the questions for one vocabulary need, built once per vocabulary. */
export interface PreparedVocabulary {
  areaQuestion: SystemOneQuestion;
  tagsByArea: Map<string, Tag[]>;
  /** Each area's tag questions, split into calls of at most {@link MAX_QUESTIONS_PER_CALL}. */
  tagQuestionCallsByArea: Map<string, Record<string, SystemOneQuestion>[]>;
}

/**
 * Translates with a System One model (JEV or SubQ): the instruction is the state; a Choice question
 * picks the areas it is about (up to {@link MAX_AREAS}, by probability), then one Noul question per
 * tag in those areas asks "Handlar texten om <description>?", at most
 * {@link MAX_QUESTIONS_PER_CALL} per call, all calls in parallel. Tags scoring at least `threshold`
 * are kept, highest score first, at most {@link MAX_QUERY_TAGS}.
 */
export function createSystemOneQueryTranslator(
  client: SystemOneClient,
  threshold: number,
): QueryTranslator {
  const prepare = memoizeByIdentity(prepareVocabulary);

  return {
    async translate(instruction, vocabulary, { exclude } = {}) {
      const { areaQuestion, tagsByArea, tagQuestionCallsByArea } = prepare(vocabulary);
      const choice = await client.ask(instruction, { [AREA_QUESTION]: areaQuestion });
      const answer = choice.answers[AREA_QUESTION];
      // The client has checked each answer's type against its question; this narrows the type.
      if (answer.type !== 'choice') {
        throw new SystemOneError(client.provider, 'response', 'Expected a choice answer');
      }
      const areas = chosenAreas(answer.probabilities, answer.choice, tagsByArea);

      // When one call fails, the others are cancelled rather than left running and billed.
      const cancel = new AbortController();
      const perCall = await Promise.all(
        areas.flatMap((area) =>
          tagQuestionCallsByArea.get(area)!.map(async (questions) => {
            const { answers, usage } = await client
              .ask(instruction, questions, cancel.signal)
              .catch((error: unknown) => {
                cancel.abort();
                throw error;
              });
            const scored = Object.keys(questions).map((slug): ScoredTag => {
              const tagAnswer = answers[slug];
              if (tagAnswer.type !== 'noul') {
                throw new SystemOneError(client.provider, 'response', 'Expected a noul answer');
              }
              return { slug, score: tagAnswer.noul };
            });
            return { scored, usage };
          }),
        ),
      );
      const askedTags = perCall.flatMap((result) => result.scored);
      const tags = askedTags
        .filter((tag) => tag.score >= threshold && !exclude?.has(tag.slug))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_QUERY_TAGS);
      return {
        tags,
        areaScores: answer.probabilities,
        askedTags,
        usage: sumUsage([choice.usage, ...perCall.map((result) => result.usage)]),
      };
    },
  };
}

/** The questions a translation asks about `vocabulary`, also for the SubQ cost estimate. */
export function prepareVocabulary(vocabulary: readonly Tag[]): PreparedVocabulary {
  const tagsByArea = groupByArea(vocabulary);
  const criteria = Object.fromEntries(
    [...tagsByArea.keys()].map((area) => [area, AREAS[area as Area] ?? area]),
  );
  const tagQuestionCallsByArea = new Map(
    [...tagsByArea].map(([area, tags]) => [
      area,
      inGroupsOf(tags, MAX_QUESTIONS_PER_CALL).map((group) =>
        Object.fromEntries(
          group.map((tag): [string, SystemOneQuestion] => [
            tag.slug,
            { type: 'noul', instructions: `Handlar texten om ${tag.description}?` },
          ]),
        ),
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
    tagQuestionCallsByArea,
  };
}

/** `items` in consecutive groups of at most `size`. */
function inGroupsOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
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
