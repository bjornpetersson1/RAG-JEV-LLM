import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(cleanup);

  it('shows the backend health status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('Backend: ok')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/health');
  });

  it.each([
    [
      'the backend answers with an error',
      () => Promise.resolve(new Response(null, { status: 502 })),
    ],
    ['the backend answers with an unexpected body', () => Promise.resolve(Response.json({}))],
    ['the request fails', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('shows unreachable when %s', async (_case, fetchImplementation) => {
    vi.stubGlobal('fetch', vi.fn(fetchImplementation));

    render(<App />);

    expect(await screen.findByText('Backend: unreachable')).toBeDefined();
  });
});
