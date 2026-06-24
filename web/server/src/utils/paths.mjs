import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
export const projectPath = (...parts) => resolve(PROJECT_ROOT, ...parts);
