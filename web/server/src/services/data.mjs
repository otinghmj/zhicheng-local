import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import { parseApplicationsFile } from '../parsers/applications.mjs';
import { inferPlatform, parsePipelineFile } from '../parsers/pipeline.mjs';
import { parseReportFile } from '../parsers/reports.mjs';
import { parseScanHistoryFile } from '../parsers/scanHistory.mjs';
import { parseStoryBankFile } from '../parsers/storyBank.mjs';
import { LruCache } from '../utils/lru.mjs';
import { notFound } from '../utils/errors.mjs';
import { projectPath } from '../utils/paths.mjs';
import { exists, listFilesRecursive, readYaml, relativePosix } from './files.mjs';

const PATHS = {
  applications: projectPath('data/applications.md'),
  pipeline: projectPath('data/pipeline.md'),
  scanHistory: projectPath('data/scan-history.tsv'),
  reports: projectPath('reports'),
  storyBank: projectPath('interview-prep/story-bank.md'),
  interviewPrep: projectPath('interview-prep'),
  output: projectPath('output'),
  cv: projectPath('cv.md'),
  states: projectPath('templates/states.yml'),
  profile: projectPath('config/profile.yml'),
  portals: projectPath('portals.yml'),
  taskHistory: projectPath('data/task-history.tsv'),
  activityLog: projectPath('data/activity-log.tsv'),
  metricsHistory: projectPath('data/metrics-history.tsv'),
  cityCodes: projectPath('scrapers/shared/city-codes.json'),
};

const reportCache = new LruCache(256);

export function invalidateDataCaches(files) {
  const changedFiles = Array.isArray(files) ? files : [files];
  for (const filePath of changedFiles) {
    if (filePath.includes(`${PATHS.reports}/`) || filePath === PATHS.reports) {
      reportCache.deleteWhere((key) => key.startsWith(`${filePath}:`));
      if (!filePath.endsWith('.md')) reportCache.clear();
    }
  }
}

function successful(rows) {
  return rows.filter((row) => row.ok !== false);
}

async function reportFiles() {
  return listFilesRecursive(PATHS.reports, '.md');
}

async function cachedReport(filePath, detail = false) {
  const metadata = await stat(filePath);
  const key = `${filePath}:${metadata.mtimeMs}:${detail ? 'detail' : 'summary'}`;
  const cached = reportCache.get(key);
  if (cached) return cached;
  return reportCache.set(key, await parseReportFile(filePath, { detail, reportsRoot: PATHS.reports }));
}

function cleanReport(report) {
  if (report.ok === false) return report;
  return {
    ...report,
    reportPath: relativePosix(projectPath(), report.reportPath),
    archetype: report.direction ?? report.archetype,
  };
}

export async function getReports({ dir } = {}) {
  const files = await reportFiles();
  const filtered = dir
    ? files.filter((filePath) => relativePosix(PATHS.reports, filePath).split('/')[0] === dir)
    : files;
  return Promise.all(filtered.map(async (filePath) => cleanReport(await cachedReport(filePath))));
}

export async function getReportDirectories() {
  try {
    const entries = await readdir(PATHS.reports, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function getReportByNumber(num, { detail = true, reportPath } = {}) {
  const filePath = (await reportFiles()).find((candidate) => (
    Number(basename(candidate).match(/^(\d+)/)?.[1]) === num
    && (!reportPath || relativePosix(projectPath(), candidate) === reportPath)
  ));
  if (!filePath) throw notFound(`未找到报告 ${num}`);
  return cleanReport(await cachedReport(filePath, detail));
}

export async function getReportRaw(num) {
  const filePath = (await reportFiles()).find((candidate) => Number(basename(candidate).match(/^(\d+)/)?.[1]) === num);
  if (!filePath) throw notFound(`未找到报告 ${num}`);
  return readFile(filePath, 'utf8');
}

export async function getReportRawByPath(reportPath) {
  const filePath = (await reportFiles()).find((candidate) => relativePosix(projectPath(), candidate) === reportPath);
  if (!filePath) throw notFound(`未找到报告 ${reportPath}`);
  return readFile(filePath, 'utf8');
}

export async function getComparisons() {
  const files = await reportFiles();
  const compareFiles = files.filter((f) => basename(f).startsWith('compare-'));
  const results = [];
  for (const filePath of compareFiles) {
    try {
      const content = await readFile(filePath, 'utf8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let frontmatter = {};
      if (fmMatch) {
        for (const line of fmMatch[1].split('\n')) {
          const [key, ...rest] = line.split(':');
          if (key && rest.length) {
            const val = rest.join(':').trim();
            if (key.trim() === 'reports') {
              frontmatter.reports = val.replace(/[\[\]]/g, '').split(',').map((n) => Number(n.trim())).filter(Boolean);
            } else {
              frontmatter[key.trim()] = val;
            }
          }
        }
      }
      const metadata = await stat(filePath);
      results.push({
        filename: basename(filePath),
        path: relativePosix(projectPath(), filePath),
        date: frontmatter.date ?? basename(filePath).match(/compare-(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
        reports: frontmatter.reports ?? [],
        mtime: metadata.mtimeMs,
      });
    } catch { /* skip unreadable files */ }
  }
  return results.sort((a, b) => b.mtime - a.mtime);
}

export async function getComparisonRaw(filename) {
  const safeName = basename(filename);
  if (!safeName.startsWith('compare-') || !safeName.endsWith('.md')) {
    throw notFound(`无效的对比报告文件名: ${filename}`);
  }
  const filePath = resolve(PATHS.reports, safeName);
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    throw notFound(`未找到对比报告: ${filename}`);
  }
}

function extractReportFallback(report) {
  const sections = report.sections ?? {};
  const text = Object.values(sections).map((section) => section.markdown).join('\n');
  const salary = text.match(/^\|\s*薪资\s*\|\s*(?:\*\*)?([^|*]+(?:薪)?)/m)?.[1]?.trim() ?? null;
  const city = text.match(/^\|\s*(?:地点|城市)\s*\|\s*(?:\*\*)?([^|*（(]+)/m)?.[1]?.trim() ?? null;
  return { salary, city };
}

export async function getApplications() {
  const [applications, pipeline, reports] = await Promise.all([
    parseApplicationsFile(PATHS.applications),
    parsePipelineFile(PATHS.pipeline),
    getReports(),
  ]);
  const pipelineByUrl = new Map(successful(pipeline).map((item) => [item.url, item]));
  const reportByNum = new Map(successful(reports).map((report) => [report.num, report]));

  return Promise.all(successful(applications).map(async (application) => {
    const report = reportByNum.get(Number(application.reportNumber));
    const pipelineItem = report ? pipelineByUrl.get(report.url) : undefined;
    let fallback = { salary: null, city: null };
    if (report && !pipelineItem) {
      fallback = extractReportFallback(await getReportByNumber(report.num));
    }
    return {
      ...application,
      jobUrl: pipelineItem?.url || report?.url || null,
      platform: pipelineItem?.platform || (report?.url ? inferPlatform(report.url) : null),
      salary: pipelineItem?.salary || fallback.salary || null,
      city: pipelineItem?.city || fallback.city || null,
      direction: report?.direction ?? null,
    };
  }));
}

export async function getPipeline() {
  const rows = await parsePipelineFile(PATHS.pipeline);
  let lastProcessed = new Date(0).toISOString();
  try { lastProcessed = (await stat(PATHS.pipeline)).mtime.toISOString(); } catch {}
  const valid = successful(rows);
  return {
    pending: valid.filter((row) => !row.processed),
    processed: valid.filter((row) => row.processed),
    errors: rows.filter((row) => row.ok === false),
    pendingCount: valid.filter((row) => !row.processed).length,
    processedCount: valid.filter((row) => row.processed).length,
    lastProcessed,
  };
}

export async function getScanHistory() {
  return successful(await parseScanHistoryFile(PATHS.scanHistory));
}

export async function getStoryBank() {
  return successful(await parseStoryBankFile(PATHS.storyBank));
}

export async function getStates() {
  return (await readYaml(PATHS.states)).states ?? [];
}

export function getProfile() {
  return readYaml(PATHS.profile);
}

export function getPortals() {
  return readYaml(PATHS.portals);
}

export async function getCv() {
  try {
    const [content, metadata] = await Promise.all([
      readFile(PATHS.cv, 'utf8'),
      stat(PATHS.cv),
    ]);
    return { content, lastModified: metadata.mtime.toISOString() };
  } catch (error) {
    if (error.code === 'ENOENT') return { content: '', lastModified: new Date(0).toISOString() };
    throw error;
  }
}

export async function getCityCodes() {
  try {
    const data = JSON.parse(await readFile(PATHS.cityCodes, 'utf8'));
    return Object.fromEntries(Object.entries(data).map(([platform, cities]) => [
      platform,
      Object.entries(cities)
        .filter(([name]) => !name.startsWith('_'))
        .map(([name, code]) => ({ name, code })),
    ]));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function parsePdfName(filename) {
  const date = filename.match(/(\d{4}-\d{2}-\d{2})(?=\.pdf$)/)?.[1] ?? null;
  const stem = basename(filename, '.pdf')
    .replace(/^cv-(?:candidate|sunzhijun|sunzj)-/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '');
  return { company: stem || null, date };
}

export async function getPdfFiles() {
  const files = await listFilesRecursive(PATHS.output, '.pdf');
  return Promise.all(files.map(async (filePath) => {
    const metadata = await stat(filePath);
    const filename = relativePosix(PATHS.output, filePath);
    return { filename, size: metadata.size, mtime: metadata.mtime.toISOString(), ...parsePdfName(filename) };
  }));
}

export function pdfPath(filename) {
  const candidate = resolve(PATHS.output, filename);
  if (candidate !== PATHS.output && !candidate.startsWith(`${PATHS.output}/`)) {
    throw notFound('PDF 文件不存在');
  }
  return candidate;
}

export async function getInterviewPrepFiles() {
  const files = await listFilesRecursive(PATHS.interviewPrep, '.md');
  return Promise.all(files.map(async (filePath) => {
    const metadata = await stat(filePath);
    return {
      slug: basename(filePath, '.md'),
      filename: basename(filePath),
      exists: true,
      mtime: metadata.mtime.toISOString(),
    };
  }));
}

export async function getInterviewPrep(slug) {
  const filePath = resolve(PATHS.interviewPrep, `${slug}.md`);
  if (!filePath.startsWith(`${PATHS.interviewPrep}/`) || !await exists(filePath)) {
    throw notFound(`未找到面试准备文件 ${slug}`);
  }
  return readFile(filePath, 'utf8');
}

const HISTORY_CONFIG = {
  task: {
    path: PATHS.taskHistory,
    columns: ['taskId', 'script', 'args', 'started', 'ended', 'exitCode', 'found', 'dedupRate'],
    numbers: new Set(['exitCode', 'found', 'dedupRate']),
  },
  activity: {
    path: PATHS.activityLog,
    columns: ['ts', 'type', 'summary'],
    numbers: new Set(),
  },
  metrics: {
    path: PATHS.metricsHistory,
    columns: ['date', 'scanned', 'pending', 'processed', 'applied', 'interview', 'offers'],
    numbers: new Set(['scanned', 'pending', 'processed', 'applied', 'interview', 'offers']),
  },
};

export async function getHistory(kind) {
  const config = HISTORY_CONFIG[kind];
  if (!await exists(config.path)) return [];
  const lines = (await readFile(config.path, 'utf8')).split(/\r?\n/).filter(Boolean);
  const firstColumn = lines[0]?.split('\t')[0];
  const hasHeader = ['task_id', 'taskId', 'ts', 'date'].includes(firstColumn);
  return lines.slice(hasHeader ? 1 : 0).map((line) => {
    const fields = line.split('\t');
    return Object.fromEntries(config.columns.map((column, index) => {
      const value = fields[index] ?? '';
      if (!value) return [column, null];
      return [column, config.numbers.has(column) ? Number(value) : value];
    }));
  });
}
