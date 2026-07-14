import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parsePipeline } from '../src/parsers/pipeline.mjs';
import { writeToPipeline } from '../../scrapers/liepin/liepin-rpa-to-pipeline.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('猎聘岗位队列写入器', () => {
  it('写入看板可识别的十字段岗位记录', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhicheng-liepin-'));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, 'report.json');
    const pipelinePath = join(directory, 'pipeline.md');

    await writeFile(reportPath, JSON.stringify({
      dedupJobs: [{
        url: 'https://www.liepin.com/job/example.shtml',
        brandName: '示例科技',
        jobName: 'AI 应用工程师',
        salaryDesc: '20-30k',
        cityName: '北京-海淀区',
        experience: '3-5年',
        degree: '本科',
        industry: '企业软件',
        companySize: '500-999人',
      }],
    }), 'utf8');

    await writeToPipeline({ reportPath, pipelinePath });

    const [item] = parsePipeline(await readFile(pipelinePath, 'utf8'));
    expect(item).toMatchObject({
      ok: true,
      processed: false,
      company: '示例科技',
      role: 'AI 应用工程师',
      salary: '20-30k',
      city: '北京-海淀区',
      experience: '3-5年',
      education: '本科',
      industry: '企业软件',
      companySize: '500-999人',
      preFilterScore: 0,
    });
  });

  it('用新版记录替换同链接的旧格式记录', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'zhicheng-liepin-'));
    temporaryDirectories.push(directory);
    const reportPath = join(directory, 'report.json');
    const pipelinePath = join(directory, 'pipeline.md');
    const url = 'https://www.liepin.com/job/example.shtml';

    await writeFile(reportPath, JSON.stringify({
      dedupJobs: [{ url, brandName: '示例科技', jobName: 'AI 应用工程师' }],
    }), 'utf8');
    await writeFile(pipelinePath, `- [ ] ${url} | 示例科技 | AI 应用工程师 | 20-30k | 北京 |undefined| undefined|undefined|undefined|undefined|||\n`, 'utf8');

    const result = await writeToPipeline({ reportPath, pipelinePath });
    const rows = parsePipeline(await readFile(pipelinePath, 'utf8'));

    expect(result).toMatchObject({ added: 1, repaired: 1, skipped: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: true, url, preFilterScore: 0 });
  });
});
