import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const DEFAULT_STATES_PATH = resolve(
  fileURLToPath(new URL('../../../..', import.meta.url)),
  'templates/states.yml',
);

export async function loadStates(filePath = DEFAULT_STATES_PATH) {
  try {
    const document = YAML.parse(await readFile(filePath, 'utf8'));
    if (!Array.isArray(document?.states)) return [];
    return document.states;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function normalizeStatus(value, states) {
  const candidate = String(value ?? '').trim().toLocaleLowerCase();
  if (!candidate || !Array.isArray(states)) return null;

  for (const state of states) {
    const names = [state.label, state.id, ...(state.aliases ?? [])];
    if (names.some((name) => String(name).trim().toLocaleLowerCase() === candidate)) {
      return state.label;
    }
  }
  return null;
}
