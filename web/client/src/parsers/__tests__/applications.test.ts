import { describe, it, expect } from 'vitest';
import { parseApplications } from '../applications';
import type { Application, StateDefinition } from '../../types';

const STATES: StateDefinition[] = [
  { id: 'evaluated', label: 'Evaluated', aliases: ['已评估'] },
  { id: 'applied', label: 'Applied', aliases: ['已投递'] },
  { id: 'skip', label: 'SKIP' },
];

const VALID_ROW = '| 1 | 2026-06-01 | Acme | Backend Engineer | 4.2/5 | Evaluated | ✅ | [1](reports/001-acme-2026-06-01.md) | Good fit |';
const HEADER = '| # | 日期 | 公司 | 职位 | 评分 | 状态 | PDF | 报告 | 备注 |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |';

describe('parseApplications', () => {
  it('parses a valid application row', () => {
    const results = parseApplications(`${HEADER}\n${VALID_ROW}`, { states: STATES });
    expect(results).toHaveLength(1);
    const app = results[0] as Application;
    expect(app.num).toBe(1);
    expect(app.date).toBe('2026-06-01');
    expect(app.company).toBe('Acme');
    expect(app.role).toBe('Backend Engineer');
    expect(app.score).toBe(4.2);
    expect(app.status).toBe('Evaluated');
    expect(app.pdfGenerated).toBe(true);
    expect(app.reportPath).toBe('reports/001-acme-2026-06-01.md');
    expect(app.notes).toBe('Good fit');
  });

  it('parses PDF ❌ as false', () => {
    const row = '| 2 | 2026-06-02 | Beta | PM | 3.0/5 | Applied | ❌ | [2](reports/002-beta-2026-06-02.md) | |';
    const results = parseApplications(`${HEADER}\n${row}`, { states: STATES });
    expect((results[0] as Application).pdfGenerated).toBe(false);
  });

  it('skips header and separator rows', () => {
    const results = parseApplications(HEADER, { states: STATES });
    expect(results).toHaveLength(0);
  });

  it('skips comment lines but parses data lines after them', () => {
    const results = parseApplications('# Applications\n' + VALID_ROW, { states: STATES });
    expect(results).toHaveLength(1);
    expect((results[0] as Application).company).toBe('Acme');
  });

  it('returns parse failure for row with too few columns', () => {
    const results = parseApplications('| 1 | 2026-06-01 | Acme |', { states: STATES });
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('ok', false);
  });

  it('returns parse failure for invalid status', () => {
    const row = '| 1 | 2026-06-01 | Acme | Role | 4.0/5 | INVALID | ✅ | [1](reports/001.md) | |';
    const results = parseApplications(`${HEADER}\n${row}`, { states: STATES });
    expect(results[0]).toHaveProperty('ok', false);
  });

  it('parses multiple valid rows', () => {
    const rows = [
      HEADER,
      '| 1 | 2026-06-01 | Acme | BE | 4.2/5 | Evaluated | ✅ | [1](reports/001.md) | |',
      '| 2 | 2026-06-02 | Beta | FE | 3.5/5 | Applied | ❌ | [2](reports/002.md) | ok |',
    ].join('\n');
    const results = parseApplications(rows, { states: STATES });
    expect(results).toHaveLength(2);
  });
});
