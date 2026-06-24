import { describe, it, expect } from 'vitest';
import { parseStoryBank } from '../story-bank';
import type { StoryBankStory } from '../../types';

const VALID_STORY = `### [领导力·创新] 从零搭建AI数据平台

**来源：** Acme公司
**S（背景）：** 公司缺乏统一的数据平台
**T（任务）：** 搭建端到端的AI数据处理流水线
**A（行动）：** 设计架构、选型、开发、部署
**R（结果）：** 处理效率提升300%
**Reflection：** 技术选型要考虑团队能力
**适用于：** 技术领导力 / 系统设计 / 创新能力`;

describe('parseStoryBank', () => {
  it('parses a valid story', () => {
    const results = parseStoryBank(VALID_STORY);
    expect(results).toHaveLength(1);
    const story = results[0] as StoryBankStory;
    expect(story.title).toBe('从零搭建AI数据平台');
    expect(story.themes).toEqual(['领导力', '创新']);
    expect(story.source).toBe('Acme公司');
    expect(story.situation).toBe('公司缺乏统一的数据平台');
    expect(story.task).toBe('搭建端到端的AI数据处理流水线');
    expect(story.action).toBe('设计架构、选型、开发、部署');
    expect(story.result).toBe('处理效率提升300%');
    expect(story.reflection).toBe('技术选型要考虑团队能力');
    expect(story.suitableFor).toEqual(['技术领导力', '系统设计', '创新能力']);
  });

  it('generates id from title', () => {
    const results = parseStoryBank(VALID_STORY);
    const story = results[0] as StoryBankStory;
    expect(story.id).toBe('从零搭建ai数据平台');
  });

  it('returns parse failure for incomplete story', () => {
    const incomplete = `### [test] Incomplete Story

**来源：** Test
**S（背景）：** Background`;

    const results = parseStoryBank(incomplete);
    expect(results[0]).toHaveProperty('ok', false);
  });

  it('parses multiple stories', () => {
    const content = `${VALID_STORY}

### [团队] 带领远程团队

**来源：** Beta公司
**S（背景）：** 疫情期间团队全部远程
**T（任务）：** 保持团队效率
**A（行动）：** 建立异步沟通机制
**R（结果）：** 效率不降反升
**Reflection：** 信任是基础
**适用于：** 团队管理 / 远程协作`;

    const results = parseStoryBank(content);
    expect(results).toHaveLength(2);
  });

  it('handles empty content', () => {
    expect(parseStoryBank('')).toHaveLength(0);
  });

  it('handles multi-line field values', () => {
    const story = `### [test] Multi Line

**来源：** Test
**S（背景）：** Line 1
Line 2
**T（任务）：** Task
**A（行动）：** Action
**R（结果）：** Result
**Reflection：** Reflection
**适用于：** Fit`;

    const results = parseStoryBank(story);
    const s = results[0] as StoryBankStory;
    expect(s.situation).toContain('Line 1');
    expect(s.situation).toContain('Line 2');
  });
});
