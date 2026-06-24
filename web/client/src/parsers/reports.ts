import YAML from 'yaml';

import type { EvaluationReportSummary, EvaluationReportDetail, ReportScores } from '../types';
import type { ParseFailure } from './shared';
import { parseFailure, parseFivePointScore } from './shared';

const SECTION_HEADING = /^##\s+([A-Z])[.)]\s*(.*)$/;
const SPECIAL_HEADINGS = new Map([
  ['综合评估', 'overall'],
  ['综合评分', 'overall'],
  ['建议下一步', 'nextSteps'],
]);

function headerValue(content: string, names: string[]): string | undefined {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return content.match(new RegExp(`^\\*\\*(?:${escaped})[:：]\\*\\*\\s*(.+)$`, 'mi'))?.[1]?.trim();
}

function parseTitle(content: string): { title?: string; company?: string; role?: string } {
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) return {};
  const parts = title.replace(/^评估[:：]\s*/, '').split(/\s*[—–]\s*/);
  if (parts.length < 2) return { title };
  if (/^评估[:：]/.test(title)) return { title, company: parts[0], role: parts.slice(1).join(' — ') };
  return { title, role: parts[0], company: parts.slice(1).join(' — ') };
}

function reportNumber(filePath: string): number | undefined {
  const name = filePath.split('/').pop() ?? '';
  const match = name.match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function reportDirection(filePath: string): string | undefined {
  const parts = filePath.split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : undefined;
}

function parseScores(content: string): ReportScores | undefined {
  const head = String(content).slice(0, 4096);
  const inline = head.match(/^scores:\s*(\{.+\})\s*$/mi)?.[1];
  const block = head.match(/^scores:\s*\n((?:[ \t]+.+\n?)+)/mi)?.[0];
  if (!inline && !block) return undefined;

  try {
    const parsed = YAML.parse(block ?? `scores: ${inline}`)?.scores;
    const keys: (keyof ReportScores)[] = ['cv_match', 'direction', 'salary', 'company', 'red_flags'];
    if (!parsed || !keys.every((key) => Number.isFinite(Number(parsed[key])))) return undefined;
    return Object.fromEntries(keys.map((key) => [key, Number(parsed[key])])) as unknown as ReportScores;
  } catch {
    return undefined;
  }
}

export function parseReportSummary(
  content: string,
  { filePath = '' } = {},
): EvaluationReportSummary | ParseFailure {
  const head = String(content).slice(0, 4096);
  const title = parseTitle(head);
  const scoreRaw = headerValue(head, ['Score', '评分']);
  const score = parseFivePointScore(scoreRaw, { nullable: true, minimum: 0 });
  const url = headerValue(head, ['URL']);
  const date = headerValue(head, ['Date', '日期']);
  const num = reportNumber(filePath);

  if (!title.company || !title.role || score === undefined || !url || !date || num === undefined) {
    return parseFailure(String(content).split(/\r?\n/)[0] ?? '', 1);
  }

  return {
    num,
    company: title.company,
    role: title.role,
    date,
    score: score as number | undefined,
    url,
    scores: parseScores(head),
    direction: reportDirection(filePath),
    reportPath: filePath,
  };
}

export function parseReportDetail(
  content: string,
  options: { filePath?: string } = {},
): EvaluationReportDetail | ParseFailure {
  const summary = parseReportSummary(content, options);
  if ('ok' in summary && summary.ok === false) return summary;

  const sections: Record<string, { title: string; markdown: string }> = {};
  let currentKey: string | undefined;
  let currentTitle: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (!currentKey) return;
    sections[currentKey] = { title: currentTitle!, markdown: buffer.join('\n').trim() };
  };

  for (const line of String(content).split(/\r?\n/)) {
    const standard = line.match(SECTION_HEADING);
    const specialTitle = line.match(/^##\s+(.+)$/)?.[1]?.trim();
    const specialKey = specialTitle ? SPECIAL_HEADINGS.get(specialTitle) : undefined;
    if (standard || specialTitle) {
      flush();
      currentKey = standard && ['A', 'B', 'C', 'D', 'E'].includes(standard[1]) ? standard[1] : specialKey;
      currentTitle = currentKey ? (standard ? `${standard[1]}. ${standard[2]}`.trim() : specialTitle) : undefined;
      buffer = [];
    } else if (currentKey) {
      buffer.push(line);
    }
  }
  flush();

  return { ...summary, sections } as EvaluationReportDetail;
}
