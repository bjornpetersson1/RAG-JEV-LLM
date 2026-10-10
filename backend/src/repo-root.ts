import { fileURLToPath } from 'node:url';

// Two levels up from both src and dist is the repo root.
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
