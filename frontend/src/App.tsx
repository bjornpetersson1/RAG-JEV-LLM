import { useEffect, useState } from 'react';
import { fetchHealthStatus } from './health';

const UNREACHABLE = 'unreachable';

export function App() {
  const [status, setStatus] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetchHealthStatus()
      .catch(() => UNREACHABLE)
      .then((result) => {
        if (!cancelled) setStatus(result);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>Legal RAG POC</h1>
      <p>Backend: {status ?? 'checking…'}</p>
    </main>
  );
}
