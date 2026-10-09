import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig } from 'vitest/config';
import { resolvePort } from '../backend/src/port.ts';

const ROOT_ENV_FILE = new URL('../.env', import.meta.url);

// Read only the root .env, the same file the backend loads, so PORT moves both together.
function readRootEnv(): NodeJS.Dict<string> {
  return existsSync(ROOT_ENV_FILE) ? parseEnv(readFileSync(ROOT_ENV_FILE, 'utf8')) : {};
}

const backendPort = resolvePort(process.env.PORT ?? readRootEnv().PORT);

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/': {
        target: `http://localhost:${backendPort}`,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    unstubGlobals: true,
  },
});
