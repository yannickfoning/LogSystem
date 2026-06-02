import path from 'path';
import { fileURLToPath } from 'url';

const __scriptsDir = path.dirname(fileURLToPath(import.meta.url));

/** Racine du dépôt LogSystem-V4 (parent du dossier scripts/). */
export const PROJECT_ROOT = path.join(__scriptsDir, '..');
