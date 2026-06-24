import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseApplications } from '../src/parsers/applications.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/applications.md', import.meta.url));
const states = [
  { id: 'evaluated', label: 'Evaluated', aliases: ['evaluada'] },
  { id: 'applied', label: 'Applied', aliases: ['aplicado', 'sent'] },
  { id: 'skip', label: 'SKIP', aliases: ['skip', 'monitor'] },
];
const row = (overrides = {}) => {
  const values = {
    num: '60',
    date: '2026-05-22',
    company: '示例制造甲',
    role: 'AI工程师',
    score: '4.4/5',
    status: 'Evaluated',
    pdf: '✅',
    report: '[060](reports/060-example.md)',
    notes: '强匹配',
    ...overrides,
  };
  return `| ${values.num} | ${values.date} | ${values.company} | ${values.role} | ${values.score} | ${values.status} | ${values.pdf} | ${values.report} | ${values.notes} |`;
};
const parseOne = (line) => parseApplications(line, { states })[0];

describe('parseApplications', () => {
  it('解析脱敏真实夹具', async () => {
    const result = parseApplications(await readFile(fixturePath, 'utf8'), { states });
    expect(result).toHaveLength(2);
  });
  it('解析编号', () => expect(parseOne(row()).num).toBe(60));
  it('解析日期', () => expect(parseOne(row()).date).toBe('2026-05-22'));
  it('解析公司', () => expect(parseOne(row()).company).toBe('示例制造甲'));
  it('解析职位', () => expect(parseOne(row()).role).toBe('AI工程师'));
  it('解析 x/5 分数', () => expect(parseOne(row()).score).toBe(4.4));
  it('保留原始分数', () => expect(parseOne(row()).scoreRaw).toBe('4.4/5'));
  it('将 N/A 分数解析为 null', () => expect(parseOne(row({ score: 'N/A' })).score).toBeNull());
  it('动态规范化状态别名', () => expect(parseOne(row({ status: 'aplicado' })).status).toBe('Applied'));
  it('状态匹配忽略大小写', () => expect(parseOne(row({ status: 'evaluated' })).status).toBe('Evaluated'));
  it('解析已生成 PDF', () => expect(parseOne(row()).pdfGenerated).toBe(true));
  it('解析未生成 PDF', () => expect(parseOne(row({ pdf: '❌' })).pdfGenerated).toBe(false));
  it('提取报告编号', () => expect(parseOne(row()).reportNumber).toBe('060'));
  it('提取报告路径', () => expect(parseOne(row()).reportPath).toBe('reports/060-example.md'));
  it('保留备注中的额外竖线', () => expect(parseOne(row({ notes: '甲 | 乙' })).notes).toBe('甲 | 乙'));
  it('支持无空格分隔', () => expect(parseOne('|60|2026-05-22|示例制造甲|AI工程师|4/5|SKIP|❌|[060](reports/060.md)|备注|').status).toBe('SKIP'));
  it('支持全角混合分隔符', () => expect(parseOne(row().replaceAll(' | ', ' ｜ ')).num).toBe(60));
  it('忽略空行和标题', () => expect(parseApplications('# 标题\n\n', { states })).toEqual([]));
  it('缺列时返回统一降级结构', () => expect(parseOne('| 60 | 2026-05-22 | 示例制造甲 |')).toMatchObject({ ok: false, line: 1 }));
  it('异常分数时降级', () => expect(parseOne(row({ score: '很好' }))).toMatchObject({ ok: false, line: 1 }));
  it('超范围分数时降级', () => expect(parseOne(row({ score: '6/5' }))).toMatchObject({ ok: false }));
  it('非法状态时降级', () => expect(parseOne(row({ status: 'Unknown' }))).toMatchObject({ ok: false }));
  it('非法编号时降级', () => expect(parseOne(row({ num: 'abc' }))).toMatchObject({ ok: false }));
  it('非法报告链接时降级', () => expect(parseOne(row({ report: '060' }))).toMatchObject({ ok: false }));
});
