import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadStates, normalizeStatus } from '../src/utils/status.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/states.yml', import.meta.url));

describe('status utils', () => {
  it('从 YAML 动态加载状态与别名', async () => {
    const states = await loadStates(fixturePath);
    expect(normalizeStatus('sent', states)).toBe('Applied');
    expect(normalizeStatus('unknown', states)).toBeNull();
  });
});
