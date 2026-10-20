// The client side of `GET /api/config` (E7-14): the flows' judges and the judge cache, so the
// introduction and the demo notice can describe the configured comparison before a query runs.

export interface AppConfig {
  /** Each flow's judge as its `RERANKER` value, e.g. `subq` or `llm`. */
  judges: { main: { name: string }; reference: { name: string } };
  judgeCache: boolean;
}

/** The configuration; throws when the backend cannot answer or answers something else. */
export async function fetchConfig(): Promise<AppConfig> {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error(`Config request failed with HTTP ${response.status}`);

  const body: unknown = await response.json();
  if (!isAppConfig(body)) throw new Error('Config request returned an unexpected body');
  return body;
}

function isAppConfig(body: unknown): body is AppConfig {
  if (typeof body !== 'object' || body === null) return false;
  const { judges, judgeCache } = body as Record<string, unknown>;
  if (typeof judges !== 'object' || judges === null || typeof judgeCache !== 'boolean') {
    return false;
  }
  const { main, reference } = judges as Record<string, unknown>;
  return hasName(main) && hasName(reference);
}

function hasName(judge: unknown): boolean {
  return (
    typeof judge === 'object' &&
    judge !== null &&
    typeof (judge as Record<string, unknown>).name === 'string'
  );
}
