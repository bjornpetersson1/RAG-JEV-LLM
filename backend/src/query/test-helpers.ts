import type { Tag } from '../llm/types.js';
import { createFakeFetch } from '../llm/test-helpers.js';

/** Twelve tags over four areas: enough to exceed the cap of 8 and the 3 areas JEV asks about. */
export const VOCABULARY: Tag[] = [
  ...['lon', 'bonus', 'provision'].map((slug) => tag(slug, 'lon')),
  ...['vite', 'skadestand', 'ranta'].map((slug) => tag(slug, 'skadestand')),
  ...['sekretessklausul', 'foretagshemlighet', 'lojalitetsplikt'].map((slug) =>
    tag(slug, 'sekretess'),
  ),
  ...['semesterlon', 'semesterdagar', 'sparade-dagar'].map((slug) => tag(slug, 'semester')),
];

function tag(slug: string, area: string): Tag {
  return { slug, label: slug, description: `${slug} i avtalet`, area };
}

/**
 * A fake JEV endpoint: the area question gets `areaProbabilities`, and each tag question the score
 * in `tagScores` (0 when missing). Records every request body.
 */
export function createFakeJev(
  areaProbabilities: Record<string, number>,
  tagScores: Record<string, number>,
) {
  return createFakeFetch((body) => {
    const questions = body.questions as Record<string, { type: string }>;
    const answers = Object.fromEntries(
      Object.entries(questions).map(([name, question]) => {
        if (question.type === 'choice') {
          const [choice] = Object.entries(areaProbabilities).sort(([, a], [, b]) => b - a)[0] ?? [
            '',
          ];
          return [
            name,
            { type: 'choice', choice, confidence: 0.9, probabilities: areaProbabilities },
          ];
        }
        return [name, { type: 'noul', noul: tagScores[name] ?? 0 }];
      }),
    );
    return Response.json({
      model: 'jev-1.13.0',
      answers,
      usage: { input_tokens: 10, output_tokens: 1 },
    });
  });
}
