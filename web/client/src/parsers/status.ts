import type { StateDefinition } from '../types';

export function normalizeStatus(value: string, states: StateDefinition[]): string | null {
  const candidate = String(value ?? '').trim().toLocaleLowerCase();
  if (!candidate || !Array.isArray(states)) return null;

  for (const state of states) {
    const names = [state.label, state.id, ...(state.aliases ?? [])];
    if (names.some((name) => String(name ?? '').trim().toLocaleLowerCase() === candidate)) {
      return state.label ?? null;
    }
  }
  return null;
}
