import { readFile } from 'node:fs/promises';

import { parseFailure } from './shared.mjs';

const STORY_HEADING = /^###\s+\[([^\]]+)\]\s+(.+)$/;
const FIELD = /^\*\*(来源|S（背景）|T（任务）|A（行动）|R（结果）|Reflection|适用于)[：:]\*\*\s*(.*)$/;
const FIELD_NAMES = {
  来源: 'source',
  'S（背景）': 'situation',
  'T（任务）': 'task',
  'A（行动）': 'action',
  'R（结果）': 'result',
  Reflection: 'reflection',
  适用于: 'suitableFor',
};

function storyId(title) {
  return title.trim().toLocaleLowerCase().replace(/\s+/g, '-');
}

export function parseStoryBank(content) {
  const lines = String(content).split(/\r?\n/);
  const results = [];
  let story;
  let field;

  const flush = () => {
    if (!story) return;
    const required = ['source', 'situation', 'task', 'action', 'result', 'reflection', 'suitableFor'];
    if (required.some((name) => !story[name]?.trim())) {
      results.push(parseFailure(story.raw, story.line));
    } else {
      const { raw, line, ...parsed } = story;
      parsed.suitableFor = parsed.suitableFor.split('/').map((item) => item.trim()).filter(Boolean);
      results.push(parsed);
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
      story[field] += `\n${raw.trim()}`;
    }
  });
  flush();

  return results;
}

export async function parseStoryBankFile(filePath) {
  try {
    return parseStoryBank(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
