import { describe, expect, it } from 'vitest';
import { createJevClient } from '../jev/client.js';
import { createCapturingLogger, createFakeFetch } from '../llm/test-helpers.js';
import { createJevJudge } from './jev-judge.js';

const JEV = {
  apiKey: 'k',
  baseUrl: 'https://jev.example/v1',
  model: 'jev-latest',
  timeoutMs: 1000,
};

function judgeAnswering(noul: number) {
  const fake = createFakeFetch(() =>
    Response.json({
      answers: { relevant: { type: 'noul', noul } },
      usage: { input_tokens: 120, output_tokens: 1 },
    }),
  );
  const client = createJevClient({
    ...JEV,
    role: 'judge',
    logger: createCapturingLogger(),
    fetch: fake.fetch,
  });
  return { judge: createJevJudge(client), requests: fake.requests };
}

describe('createJevJudge', () => {
  it('sends the source and text as state and the instruction as one Noul question', async () => {
    const { judge, requests } = judgeAnswering(0.8);

    const judgement = await judge.judge('Sekretessavtal för en konsult', {
      id: 'c1',
      text: 'Arbetstagaren får inte röja företagshemligheter.',
      source: 'SFS 2018:558 2 §',
    });

    expect(requests[0].body).toEqual({
      state: 'SFS 2018:558 2 §\n\nArbetstagaren får inte röja företagshemligheter.',
      model: 'jev-latest',
      questions: {
        relevant: {
          type: 'noul',
          instructions: 'Är texten relevant för följande uppdrag: Sekretessavtal för en konsult?',
        },
      },
    });
    expect(judgement).toEqual({
      score: 0.8,
      judgedBy: 'jev',
      usage: { inputTokens: 120, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
    });
  });

  it('sends only the text when the chunk has no source', async () => {
    const { judge, requests } = judgeAnswering(0.2);

    await expect(judge.judge('x', { id: 'c1', text: 'Bara text.' })).resolves.toMatchObject({
      score: 0.2,
    });
    expect(requests[0].body.state).toBe('Bara text.');
  });
});
