import type { StoryBankStory } from '../types';
import type { ParseFailure } from './shared';
import { parseFailure } from './shared';

const STORY_HEADING = /^###\s+\[([^\]]+)\]\s+(.+)$/;
const FIELD = /^\*\*(来源|S（背景）|T（任务）|A（行动）|R（结果）|Reflection|适用于)[：:]\*\*\s*(.*)$/;
const FIELD_NAMES: Record<string, string> = {
  来源: 'source',
  'S（背景）': 'situation',
  'T（任务）': 'task',
  'A（行动）': 'action',
  'R（结果）': 'result',
  Reflection: 'reflection',
  适用于: 'suitableFor',
};

function storyId(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, '-');
}

export function parseStoryBank(content: string): Array<StoryBankStory | ParseFailure> {
  const lines = String(content).split(/\r?\n/);
  const results: Array<StoryBankStory | ParseFailure> = [];
  let story: Record<string, unknown> | undefined;
  let field: string | undefined;

  const flush = () => {
    if (!story) return;
    const required = ['source', 'situation', 'task', 'action', 'result', 'reflection', 'suitableFor'];
    if (required.some((name) => !String(story![name] ?? '').trim())) {
      results.push(parseFailure(story.raw as string, story.line as number));
    } else {
      const suitableFor = String(story.suitableFor).split('/').map((item) => item.trim()).filter(Boolean);
      results.push({
        id: story.id as string,
        title: story.title as string,
        themes: story.themes as string[],
        source: story.source as string,
        situation: story.situation as string,
        task: story.task as string,
        action: story.action as string,
        result: story.result as string,
        reflection: story.reflection as string,
        suitableFor,
      });
    }
  };

  lines.forEach((raw, index) => {
    const heading = raw.match(STORY_HEADING);
    if (heading) {
      flush();
      story = {
        id: storyId(heading[2]),
        title: heading[2].trim(),
        themes: heading[1].split('·').map((item) => item.trim()).filter(Boolean),
        raw,
        line: index + 1,
      };
      field = undefined;
      return;
    }
    if (!story) return;

    const fieldMatch = raw.match(FIELD);
    if (fieldMatch) {
      field = FIELD_NAMES[fieldMatch[1]];
      story[field] = fieldMatch[2].trim();
    } else if (field && raw.trim() && raw.trim() !== '---') {
      story[field] = (story[field] as string) + `\n${raw.trim()}`;
    }
  });
  flush();

  return results;
}
