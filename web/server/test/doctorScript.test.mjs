import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));

describe('doctor script', () => {
  it('returns structured checks for the dashboard when --json is used', () => {
    const result = spawnSync(process.execPath, ['scripts/doctor.mjs', '--json'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'node', label: expect.stringContaining('Node.js'), status: 'ok' }),
    ]));
  });
});
