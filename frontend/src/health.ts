export async function fetchHealthStatus(): Promise<string> {
  const response = await fetch('/api/health');
  if (!response.ok) throw new Error(`Health check failed with HTTP ${response.status}`);

  const body: unknown = await response.json();
  if (!isHealthResponse(body)) throw new Error('Health check returned an unexpected body');
  return body.status;
}

function isHealthResponse(body: unknown): body is { status: string } {
  return (
    typeof body === 'object' && body !== null && 'status' in body && typeof body.status === 'string'
  );
}
