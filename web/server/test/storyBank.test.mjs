import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseStoryBank } from '../src/parsers/storyBank.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/story-bank.md', import.meta.url));

describe('parseStoryBank', () => {
  it('解析标签、STAR+R 和斜杠场景列表', async () => {
    const [story] = parseStoryBank(await readFile(fixturePath, 'utf8'));
    expect(story).toMatchObject({
      title: '示例知识图谱系统',
      themes: ['独立交付', '系统从0到1'],
      source: '示例制造甲 · 数字化部门',
      suitableFor: ['独立交付', '从0到1', 'AI应用落地'],
    });
    expect(story).not.toHaveProperty('date');
  });
  it('缺少字段时返回统一降级结构', () => {
    expect(parseStoryBank('### [标签] 不完整故事\n**来源：** 示例')[0]).toMatchObject({ ok: false, line: 1 });
  });
});
