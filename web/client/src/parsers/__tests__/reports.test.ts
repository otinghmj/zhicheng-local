import { describe, it, expect } from 'vitest';
import { parseReportSummary, parseReportDetail } from '../reports';
import type { EvaluationReportSummary } from '../../types';

const VALID_REPORT = `# 评估：Acme — Backend Engineer

**评分：** 4.2/5
**URL:** https://example.com/job/123
**日期：** 2026-06-01

scores:
  cv_match: 4
  direction: 5
  salary: 3
  company: 4
  red_flags: 5

## A) CV匹配度

这是 A 段的内容。

## B) 发展方向

这是 B 段的内容。

## 综合评估

总体来看这是个不错的机会。

## 建议下一步

准备面试。
`;

describe('parseReportSummary', () => {
  it('parses a valid report', () => {
    const result = parseReportSummary(VALID_REPORT, { filePath: 'reports/001-acme-2026-06-01.md' }) as EvaluationReportSummary;
    expect(result.company).toBe('Acme');
    expect(result.role).toBe('Backend Engineer');
    expect(result.score).toBe(4.2);
    expect(result.url).toBe('https://example.com/job/123');
    expect(result.date).toBe('2026-06-01');
    expect(result.num).toBe(1);
  });

  it('parses YAML scores block', () => {
    const result = parseReportSummary(VALID_REPORT, { filePath: 'reports/001-acme-2026-06-01.md' }) as EvaluationReportSummary;
    expect(result.scores).toBeDefined();
    expect(result.scores?.cv_match).toBe(4);
    expect(result.scores?.direction).toBe(5);
    expect(result.scores?.salary).toBe(3);
  });

  it('returns parse failure for missing fields', () => {
    const result = parseReportSummary('# Just a title\n\nNo other fields.', { filePath: 'reports/001.md' });
    expect(result).toHaveProperty('ok', false);
  });

  it('extracts report number from filename', () => {
    const result = parseReportSummary(VALID_REPORT, { filePath: 'reports/042-acme-2026-06-01.md' }) as EvaluationReportSummary;
    expect(result.num).toBe(42);
  });
});

describe('parseReportDetail', () => {
  it('parses sections', () => {
    const result = parseReportDetail(VALID_REPORT, { filePath: 'reports/001-acme-2026-06-01.md' });
    if ('ok' in result) throw new Error('Expected success');
    expect(result.sections).toBeDefined();
    expect(result.sections?.A?.markdown).toContain('A 段的内容');
    expect(result.sections?.B?.markdown).toContain('B 段的内容');
    expect(result.sections?.overall?.markdown).toContain('不错的机会');
    expect(result.sections?.nextSteps?.markdown).toContain('准备面试');
  });
});
