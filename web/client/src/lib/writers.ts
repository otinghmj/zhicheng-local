import { parseApplications } from '../parsers/applications';
import { parsePipeline } from '../parsers/pipeline';
import type { Application, ApplicationCreate, ApplicationUpdate, StateDefinition } from '../types';

function markdownSeparators(line: string): number[] {
  return [...line.matchAll(/[|｜]/g)].map((m) => m.index!);
}

function replaceMarkdownCell(
  line: string,
  index: number,
  value: string,
  { throughEnd = false } = {},
): string | null {
  const seps = markdownSeparators(line);
  if (seps.length < index + 2) return null;
  const start = seps[index] + 1;
  const end = throughEnd ? seps.at(-1)! : seps[index + 1];
  const original = line.slice(start, end);
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  return `${line.slice(0, start)}${leading}${value}${trailing}${line.slice(end)}`;
}

export function modifyApplicationContent(
  content: string,
  num: number,
  patch: ApplicationUpdate,
  states: StateDefinition[],
): string {
  if (patch.status !== undefined && !states.some((s) => s.label === patch.status)) {
    throw new Error(`Status "${patch.status}" 不在 states 枚举中`);
  }
  const lines = content.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    const [parsed] = parseApplications(line, { states });
    if (parsed && !('ok' in parsed && parsed.ok === false) && (parsed as Application).num === num) {
      found = true;
      let updated = line;
      if (patch.status !== undefined) updated = replaceMarkdownCell(updated, 5, patch.status) ?? updated;
      if (patch.notes !== undefined) updated = replaceMarkdownCell(updated, 8, patch.notes, { throughEnd: true }) ?? updated;
      return updated;
    }
    return line;
  });
  if (!found) throw new Error(`未找到应用记录 #${num}`);
  return next.join('\n');
}

export function deleteApplicationLine(content: string, num: number): string {
  const lines = content.split(/\r?\n/);
  let found = false;
  const next = lines.filter((line) => {
    const [parsed] = parseApplications(line, {});
    if (parsed && !('ok' in parsed && parsed.ok === false) && (parsed as Application).num === num) {
      found = true;
      return false;
    }
    return true;
  });
  if (!found) throw new Error(`未找到应用记录 #${num}`);
  return next.join('\n');
}

export function appendApplicationRow(
  content: string,
  input: ApplicationCreate,
): Application {
  const existing = parseApplications(content, {});
  const apps = existing.filter((r): r is Application => !('ok' in r && r.ok === false));
  if (apps.some((a) => a.company === input.company && a.role === input.role)) {
    throw new Error('该公司+职位组合已存在');
  }
  const maxNum = apps.reduce((max, a) => Math.max(max, a.num ?? 0), 0);
  const num = maxNum + 1;
  const scoreStr = typeof input.score === 'number' ? `${input.score.toFixed(1)}/5` : '—';
  const pdf = input.pdfGenerated ? '✅' : '❌';
  const reportNum = num;
  const report = input.reportPath ? `[${reportNum}](${input.reportPath})` : `[${num}](—)`;
  const row = `| ${num} | ${input.date} | ${input.company} | ${input.role} | ${scoreStr} | ${input.status} | ${pdf} | ${report} | ${input.notes ?? ''} |`;
  return {
    num,
    date: input.date,
    company: input.company,
    role: input.role,
    score: typeof input.score === 'number' ? input.score : null,
    scoreRaw: scoreStr,
    status: input.status,
    pdfGenerated: !!input.pdfGenerated,
    reportPath: input.reportPath ?? undefined,
    reportNumber: String(reportNum),
    notes: input.notes ?? '',
    _appendedRow: row,
  } as Application & { _appendedRow: string };
}

export function appendApplicationContent(content: string, row: string): string {
  return `${content.trimEnd()}\n${row}\n`;
}

export function patchPipelineContent(
  content: string,
  { remove = [] as string[], updates = [] as Array<{ url: string; processed: boolean }> },
): { content: string; removed: Array<{ url: string; company: string; role: string }> } {
  const removeSet = new Set(remove);
  const updateMap = new Map(updates.map((u) => [u.url, u.processed]));
  const removed: Array<{ url: string; company: string; role: string }> = [];
  const lines = content.split(/\r?\n/);
  const next = lines.flatMap((line) => {
    const [parsed] = parsePipeline(line);
    if (!parsed || ('ok' in parsed && parsed.ok === false)) return [line];
    const item = parsed as { url: string; company: string; role: string; processed: boolean; salary: string; city: string; experience: string; education: string; industry: string; companySize: string; preFilterScore: number };
    if (removeSet.has(item.url)) {
      removed.push({ url: item.url, company: item.company, role: item.role });
      return [];
    }
    if (updateMap.has(item.url)) {
      const processed = updateMap.get(item.url)!;
      return [`- [${processed ? 'x' : ' '}] ${item.url} | ${item.company} | ${item.role} | ${item.salary} | ${item.city} | ${item.experience} | ${item.education} | ${item.industry} | ${item.companySize} | 初筛分:${item.preFilterScore}/5`];
    }
    return [line];
  });
  return { content: next.join('\n'), removed };
}

export function appendPipelineUrl(
  content: string,
  { url, company = '', role = '' }: { url: string; company?: string; role?: string },
): string {
  const items = parsePipeline(content);
  if (items.some((i) => !('ok' in i && i.ok === false) && (i as { url: string }).url === url)) {
    throw new Error('URL 已存在于 Pipeline');
  }
  const row = `- [ ] ${url} | ${company} | ${role} |  |  |  |  |  |  | 初筛分:5/5`;
  const heading = /^## Pending\s*$/m;
  if (!heading.test(content)) return `${content.trimEnd()}\n\n## Pending\n\n${row}\n`;
  return content.replace(heading, (match) => `${match}\n\n${row}`);
}
