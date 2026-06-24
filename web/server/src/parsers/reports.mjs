import { open, readdir, readFile } from 'node:fs/promises';
import { basename, relative, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { parseFailure, parseFivePointScore } from './shared.mjs';

const SECTION_HEADING = /^##\s+([A-Z])[.)]\s*(.*)$/;
const SPECIAL_HEADINGS = new Map([
  ['综合评估', 'overall'],
  ['综合评分', 'overall'],
  ['建议下一步', 'nextSteps'],
]);

function headerValue(content, names) {
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return content.match(new RegExp(`^\\*\\*(?:${escaped})[:：]\\*\\*\\s*(.+)$`, 'mi'))?.[1]?.trim();
}

function parseTitle(content) {
  const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) return {};
  const parts = title.replace(/^评估[:：]\s*/, '').split(/\s*[—–]\s*/);
  if (parts.length < 2) return { title };
  if (/^评估[:：]/.test(title)) return { title, company: parts[0], role: parts.slice(1).join(' — ') };
  return { title, role: parts[0], company: parts.slice(1).join(' — ') };
}

function reportNumber(filePath) {
  const match = basename(filePath ?? '').match(/^(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function reportDirection(filePath, reportsRoot) {
  if (!filePath || !reportsRoot) return undefined;
  const parts = relative(reportsRoot, filePath).split(sep);
  return parts.length > 1 ? parts[0] : undefined;
}

function parseScores(content) {
  const head = String(content).slice(0, 4096);
  const inline = head.match(/^scores:\s*(\{.+\})\s*$/mi)?.[1];
  const block = head.match(/^scores:\s*\n((?:[ \t]+.+\n?)+)/mi)?.[0];
  if (!inline && !block) return undefined;

  try {
    const parsed = parseYaml(block ?? `scores: ${inline}`)?.scores;
    const keys = ['cv_match', 'direction', 'salary', 'company', 'red_flags'];
    if (!parsed || !keys.every((key) => Number.isFinite(Number(parsed[key])))) return undefined;
    return Object.fromEntries(keys.map((key) => [key, Number(parsed[key])]));
  } catch {
    return undefined;
  }
}

export function parseReportSummary(content, { filePath = '', reportsRoot } = {}) {
  const head = String(content).slice(0, 4096);
  const title = parseTitle(head);
  const scoreRaw = headerValue(head, ['Score', '评分']);
  const score = parseFivePointScore(scoreRaw, { nullable: true, minimum: 0 });
  const url = headerValue(head, ['URL']);
  const date = headerValue(head, ['Date', '日期']);
  const verification = headerValue(head, ['Verification']);
  const num = reportNumber(filePath);

  if (!title.company || !title.role || score === undefined || !url || !date || num === undefined) {
    return parseFailure(String(content).split(/\r?\n/)[0] ?? '', 1);
  }

  return {
    num,
    company: title.company,
    role: title.role,
    date,
    score,
    scoreRaw,
    url,
    verification,
    scores: parseScores(head),
    direction: reportDirection(filePath, reportsRoot),
    reportPath: filePath,
  };
}

export function parseReportDetail(content, options = {}) {
  const summary = parseReportSummary(content, options);
  if (summary.ok === false) return summary;

  const sections = {};
  let currentKey;
  let currentTitle;
  let buffer = [];

  const flush = () => {
    if (!currentKey) return;
    sections[currentKey] = { title: currentTitle, markdown: buffer.join('\n').trim() };
  };

  for (const line of String(content).split(/\r?\n/)) {
    const standard = line.match(SECTION_HEADING);
    const specialTitle = line.match(/^##\s+(.+)$/)?.[1]?.trim();
    const specialKey = SPECIAL_HEADINGS.get(specialTitle);
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

  return { ...summary, sections };
}

export async function parseReportFile(filePath, { detail = false, reportsRoot } = {}) {
  if (detail) {
    return parseReportDetail(await readFile(filePath, 'utf8'), { filePath, reportsRoot });
  }

  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return parseReportSummary(buffer.toString('utf8', 0, bytesRead), { filePath, reportsRoot });
  } finally {
    await handle.close();
  }
}

export async function parseReportsDirectory(reportsRoot, { detail = false } = {}) {
  const entries = await readdir(reportsRoot, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `${entry.parentPath ?? entry.path}${sep}${entry.name}`);
  return Promise.all(files.map((filePath) => parseReportFile(filePath, { detail, reportsRoot })));
}
