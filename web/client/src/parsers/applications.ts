import type { Application, StateDefinition } from '../types';
import type { ParseFailure } from './shared';
import { parseFailure, parseFivePointScore, splitMarkdownRow } from './shared';
import { normalizeStatus } from './status';

const REPORT_LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

export function parseApplications(
  content: string,
  { states = [] as StateDefinition[] } = {},
): Array<Application | ParseFailure> {
  const results: Array<Application | ParseFailure> = [];
  const lines = String(content).split(/\r?\n/);

  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('|')) return;

    const columns = splitMarkdownRow(raw);
    if (columns[0] === '#' || columns.every((column) => /^:?-+:?$/.test(column))) return;
    if (columns.length < 9) {
      results.push(parseFailure(raw, index + 1));
      return;
    }

    const [numRaw, date, company, role, scoreRaw, statusRaw, pdfRaw, reportRaw, ...notes] = columns;
    const num = Number(numRaw);
    const score = parseFivePointScore(scoreRaw, { nullable: true, minimum: 1 });
    const status = normalizeStatus(statusRaw, states);
    const report = reportRaw.match(REPORT_LINK);
    const pdfGenerated = pdfRaw === '✅' ? true : pdfRaw === '❌' ? false : undefined;

    if (!Number.isInteger(num) || !date || !company || !role || score === undefined || !status || !report || pdfGenerated === undefined) {
      results.push(parseFailure(raw, index + 1));
      return;
    }

    results.push({
      num,
      date,
      company,
      role,
      score,
      scoreRaw,
      status,
      pdfGenerated,
      reportNumber: report[1],
      reportPath: report[2],
      notes: notes.join(' | '),
    });
  });

  return results;
}
