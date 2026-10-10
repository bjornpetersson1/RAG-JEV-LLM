import { join } from 'node:path';
import { REPO_ROOT } from '../repo-root.js';

/** The committed tag vocabulary with the template presets. */
export const VOCABULARY_PATH = join(REPO_ROOT, 'sources', 'tags.json');
