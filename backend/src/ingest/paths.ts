import { join } from 'node:path';
import { REPO_ROOT } from '../repo-root.js';

/** The committed list of laws and rulings the POC uses. */
export const SELECTION_PATH = join(REPO_ROOT, 'sources', 'selection.json');

/** Where `data:fetch` stores raw documents and the manifest; git-ignored with the rest of `data/`. */
export const RAW_DATA_DIR = join(REPO_ROOT, 'data', 'raw');
