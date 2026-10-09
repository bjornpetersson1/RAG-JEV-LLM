// Imported by frontend/vite.config.ts for the dev proxy target, so keep this module free of
// imports and side effects.

export const DEFAULT_PORT = 3000;

const MAX_PORT = 65535;

export function resolvePort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    throw new Error(`Invalid PORT "${value}": expected an integer between 1 and ${MAX_PORT}`);
  }
  return port;
}
