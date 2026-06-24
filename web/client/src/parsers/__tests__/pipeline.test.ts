import { describe, it, expect } from 'vitest';
import { parsePipeline, inferPlatform } from '../pipeline';
import type { PipelineParsedItem } from '../../types';

describe('inferPlatform', () => {
  it('detects BOSS zhipin', () => {
    expect(inferPlatform('https://www.zhipin.com/job/123')).toBe('BOSS');
    expect(inferPlatform('https://zhipin.com/job/123')).toBe('BOSS');
  });

  it('detects 猎聘', () => {
    expect(inferPlatform('https://www.liepin.com/job/123')).toBe('猎聘');
  });

  it('detects 智联', () => {
    expect(inferPlatform('https://jobs.zhaopin.com/123')).toBe('智联');
  });

  it('detects 前程无忧', () => {
    expect(inferPlatform('https://jobs.51job.com/123')).toBe('前程无忧');
  });

  it('returns 其他 for unknown', () => {
    expect(inferPlatform('https://example.com/job')).toBe('其他');
  });

  it('returns 其他 for invalid URL', () => {
    expect(inferPlatform('not-a-url')).toBe('其他');
  });
});

describe('parsePipeline', () => {
  const fields = [
    'https://www.zhipin.com/job/123',
    'Acme',
    'Backend Engineer',
    '25-35K',
    '上海',
    '3-5年',
    '本科',
    '互联网',
    '500-999人',
    '初筛分: 4.0/5',
  ];

  it('parses a valid unprocessed item', () => {
    const line = `- [ ] ${fields.join(' | ')}`;
    const results = parsePipeline(line);
    expect(results).toHaveLength(1);
    const item = results[0] as PipelineParsedItem;
    expect(item.ok).toBe(true);
    expect(item.url).toBe('https://www.zhipin.com/job/123');
    expect(item.company).toBe('Acme');
    expect(item.role).toBe('Backend Engineer');
    expect(item.salary).toBe('25-35K');
    expect(item.city).toBe('上海');
    expect(item.preFilterScore).toBe(4.0);
    expect(item.platform).toBe('BOSS');
    expect(item.processed).toBe(false);
  });

  it('parses a processed item', () => {
    const line = `- [x] ${fields.join(' | ')}`;
    const results = parsePipeline(line);
    expect((results[0] as PipelineParsedItem).processed).toBe(true);
  });

  it('rejects line with too few fields', () => {
    const line = '- [ ] https://example.com | Acme | Role';
    const results = parsePipeline(line);
    expect(results[0]).toHaveProperty('ok', false);
  });

  it('rejects line with invalid score', () => {
    const badFields = [...fields.slice(0, -1), '初筛分: invalid'];
    const line = `- [ ] ${badFields.join(' | ')}`;
    const results = parsePipeline(line);
    expect(results[0]).toHaveProperty('ok', false);
  });

  it('ignores non-checkbox lines', () => {
    expect(parsePipeline('## Pending')).toHaveLength(0);
    expect(parsePipeline('some random text')).toHaveLength(0);
    expect(parsePipeline('')).toHaveLength(0);
  });
});
