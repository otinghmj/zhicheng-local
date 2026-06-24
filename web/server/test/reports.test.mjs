import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseReportDetail, parseReportSummary } from '../src/parsers/reports.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/reports/主线A-工业AI/060-example.md', import.meta.url));

describe('reports parser', () => {
  it('列表模式只返回头部元数据', async () => {
    const content = await readFile(fixturePath, 'utf8');
    const result = parseReportSummary(content, { filePath: fixturePath, reportsRoot: fileURLToPath(new URL('./fixtures/reports', import.meta.url)) });
    expect(result).toMatchObject({ num: 60, role: 'AI应用开发工程师', company: '示例制造甲', score: 4.4, direction: '主线A-工业AI' });
    expect(result.sections).toBeUndefined();
  });
  it('详情模式切分 A-E、综合评估和建议下一步', async () => {
    const result = parseReportDetail(await readFile(fixturePath, 'utf8'), { filePath: fixturePath });
    expect(Object.keys(result.sections)).toEqual(['A', 'B', 'C', 'D', 'E', 'overall', 'nextSteps']);
    expect(result.sections.nextSteps.markdown).toContain('下一步内容');
  });
  it('缺失必需头部时返回统一降级结构', () => {
    expect(parseReportSummary('# 不完整报告', { filePath: '061-bad.md' })).toMatchObject({ ok: false, line: 1 });
  });
  it('支持标题破折号两侧没有空格', () => {
    const content = '# AI工程师—示例制造乙\n\n**Score:** 4/5\n**URL:** https://example.com\n**Date:** 2026-05-22';
    expect(parseReportSummary(content, { filePath: '062-example.md' })).toMatchObject({ company: '示例制造乙', role: 'AI工程师' });
  });
  it('支持中文评分字段和 N/A', () => {
    const content = '# 评估：示例制造乙 — 已关闭职位\n\n**评分：** N/A\n**URL：** https://example.com\n**日期：** 2026-05-22';
    expect(parseReportSummary(content, { filePath: '063-example.md' })).toMatchObject({ company: '示例制造乙', role: '已关闭职位', score: null });
  });
  it('读取报告头部的五维 scores YAML', () => {
    const content = '# AI工程师 — 示例制造乙\n\n**Score:** 4.5/5\n**URL:** https://example.com\n**Date:** 2026-05-22\nscores: { cv_match: 4.5, direction: 4.8, salary: 3.5, company: 4, red_flags: 4.2 }';
    expect(parseReportSummary(content, { filePath: '064-example.md' }).scores).toEqual({
      cv_match: 4.5,
      direction: 4.8,
      salary: 3.5,
      company: 4,
      red_flags: 4.2,
    });
  });
  it('旧报告中的 F 块不会混入 E 块，并把综合评分归入综合评估', () => {
    const content = '# AI工程师 — 示例制造乙\n\n**Score:** 4.5/5\n**URL:** https://example.com\n**Date:** 2026-05-22\n\n## E) 个性化方案\nE 内容\n\n## F) 面试准备\nF 内容\n\n## 综合评分\n综合内容';
    const result = parseReportDetail(content, { filePath: '065-example.md' });
    expect(result.sections.E.markdown).toBe('E 内容');
    expect(result.sections.F).toBeUndefined();
    expect(result.sections.overall.markdown).toBe('综合内容');
  });
});
