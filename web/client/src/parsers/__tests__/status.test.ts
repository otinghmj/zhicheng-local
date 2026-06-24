import { describe, it, expect } from 'vitest';
import { normalizeStatus } from '../status';
import type { StateDefinition } from '../../types';

const STATES: StateDefinition[] = [
  { id: 'evaluated', label: 'Evaluated', aliases: ['已评估'] },
  { id: 'applied', label: 'Applied', aliases: ['已投递'] },
  { id: 'rejected', label: 'Rejected', aliases: ['已拒绝'] },
  { id: 'skip', label: 'SKIP' },
];

describe('normalizeStatus', () => {
  it('matches by label (case-insensitive)', () => {
    expect(normalizeStatus('evaluated', STATES)).toBe('Evaluated');
    expect(normalizeStatus('EVALUATED', STATES)).toBe('Evaluated');
  });

  it('matches by id', () => {
    expect(normalizeStatus('applied', STATES)).toBe('Applied');
  });

  it('matches by alias', () => {
    expect(normalizeStatus('已评估', STATES)).toBe('Evaluated');
    expect(normalizeStatus('已投递', STATES)).toBe('Applied');
  });

  it('returns null for unknown status', () => {
    expect(normalizeStatus('unknown', STATES)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeStatus('', STATES)).toBeNull();
  });

  it('returns null for empty states array', () => {
    expect(normalizeStatus('Evaluated', [])).toBeNull();
  });
});
