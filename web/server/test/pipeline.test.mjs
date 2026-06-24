import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { inferPlatform, parsePipeline } from '../src/parsers/pipeline.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/pipeline.md', import.meta.url));

describe('parsePipeline', () => {
  it('解析 Pending、Processed，并保留残缺行', async () => {
    const result = parsePipeline(await readFile(fixturePath, 'utf8'));
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ ok: true, processed: false, platform: 'BOSS', preFilterScore: 4.5 });
    expect(result[1]).toMatchObject({ ok: false, url: 'https://www.liepin.com/job/example.shtml' });
    expect(result[2]).toMatchObject({ ok: true, processed: true, platform: '前程无忧' });
  });
  it.each([
    ['https://zhipin.com/a', 'BOSS'],
    ['https://liepin.com/a', '猎聘'],
    ['https://zhaopin.com/a', '智联'],
    ['https://51job.com/a', '前程无忧'],
    ['https://example.com/a', '其他'],
  ])('从 URL %s 推断平台', (url, platform) => expect(inferPlatform(url)).toBe(platform));
  it('把全角竖线保留为字段内容', () => {
    const [result] = parsePipeline('- [ ] https://example.com/job | 示例制造 | AI｜应用工程师 | 15K | 深圳 | 3年 | 本科 | 软件 | 100人 | 初筛分:4/5');
    expect(result).toMatchObject({ ok: true, role: 'AI｜应用工程师' });
  });
});
