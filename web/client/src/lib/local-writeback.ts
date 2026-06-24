import { readFileOrDefault, writeFile } from './fs';

export interface ScrapedJob {
  url: string;
  jobName: string;
  brandName?: string;
  salaryDesc?: string;
  cityName?: string;
  areaDistrict?: string;
  jobExperience?: string;
  experience?: string;
  jobDegree?: string;
  degree?: string;
  brandIndustry?: string;
  industry?: string;
  brandScaleName?: string;
  companySize?: string;
  brandStageName?: string;
  companyStage?: string;
  skills?: string | string[];
  welfareList?: string | string[];
  jobLabels?: string | string[];
}

export interface ScrapeResult {
  ok: boolean;
  source: string;
  dedupJobs: ScrapedJob[];
  dedupCount?: number;
  rawJobCount?: number;
}

const PORTAL_NAMES: Record<string, string> = {
  boss: 'BOSS',
  liepin: '猎聘',
  zhaopin: '智联',
  '51job': '前程无忧',
};

function arr(v: string | string[] | undefined): string {
  if (!v) return '';
  return Array.isArray(v) ? v.join('、') : v;
}

function formatPendingLine(job: ScrapedJob): string {
  const location = [job.cityName, job.areaDistrict].filter(Boolean).join('·');
  const skills = arr(job.skills);
  const welfare = arr(job.welfareList);
  const labels = arr(job.jobLabels);
  const exp = job.jobExperience ?? job.experience ?? '';
  const deg = job.jobDegree ?? job.degree ?? '';
  const ind = job.brandIndustry ?? job.industry ?? '';
  const scale = job.brandScaleName ?? job.companySize ?? '';
  const stage = job.brandStageName ?? job.companyStage ?? '';
  return `- [ ] ${job.url} | ${job.brandName ?? ''} | ${job.jobName} | ${job.salaryDesc ?? ''} | ${location} |${exp}| ${deg}|${ind}|${scale}|${stage}|${skills}|${welfare}|${labels}`;
}

function extractExistingUrls(content: string): Set<string> {
  const urls = new Set<string>();
  for (const line of content.split('\n')) {
    const m = line.match(/https?:\/\/[^\s|]+/);
    if (m) urls.add(m[0].split('?')[0]);
  }
  return urls;
}

export function mergePipeline(
  existingContent: string,
  jobs: ScrapedJob[],
): { content: string; addedUrls: Set<string>; skippedCount: number } {
  const existing = extractExistingUrls(existingContent);
  const newLines: string[] = [];
  const addedUrls = new Set<string>();
  let skippedCount = 0;

  for (const job of jobs) {
    if (!job.url) { skippedCount++; continue; }
    const clean = job.url.split('?')[0];
    if (existing.has(clean)) { skippedCount++; continue; }
    newLines.push(formatPendingLine(job));
    addedUrls.add(clean);
  }

  if (newLines.length === 0) return { content: existingContent, addedUrls, skippedCount };

  const insert = '\n' + newLines.join('\n');
  const processedIdx = existingContent.indexOf('\n## Processed');
  if (processedIdx !== -1) {
    return {
      content: existingContent.slice(0, processedIdx) + insert + existingContent.slice(processedIdx),
      addedUrls,
      skippedCount,
    };
  }

  const pendingIdx = existingContent.indexOf('## Pending');
  if (pendingIdx === -1) {
    return { content: existingContent + insert + '\n', addedUrls, skippedCount };
  }
  return { content: existingContent + insert + '\n', addedUrls, skippedCount };
}

export function buildScanHistoryRows(
  jobs: ScrapedJob[],
  addedUrls: Set<string>,
  portal: string,
): string {
  const now = new Date().toISOString().slice(0, 10);
  const rows: string[] = [];
  for (const job of jobs) {
    if (!job.url) continue;
    const clean = job.url.split('?')[0];
    const status = addedUrls.has(clean) ? 'added' : 'skipped_dup';
    const title = (job.jobName ?? '').replaceAll('\t', ' ');
    const company = (job.brandName ?? '').replaceAll('\t', ' ');
    rows.push(`${clean}\t${now}\t${portal}\t${title}\t${company}\t${status}`);
  }
  return rows.join('\n');
}

export async function writeBackScrapeResult(
  dirHandle: FileSystemDirectoryHandle,
  result: ScrapeResult,
): Promise<{ added: number; skipped: number }> {
  const jobs = result.dedupJobs;
  if (!jobs || jobs.length === 0) return { added: 0, skipped: 0 };

  const pipeContent = await readFileOrDefault(dirHandle, 'data/pipeline.md', '## Pending\n\n## Processed\n');
  const { content: updated, addedUrls, skippedCount } = mergePipeline(pipeContent, jobs);

  if (addedUrls.size > 0) {
    await writeFile(dirHandle, 'data/pipeline.md', updated);
  }

  const portal = PORTAL_NAMES[result.source] ?? result.source;
  const rows = buildScanHistoryRows(jobs, addedUrls, portal);
  if (rows) {
    const existing = await readFileOrDefault(dirHandle, 'data/scan-history.tsv', '');
    const header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';
    const base = existing.trim() || header;
    await writeFile(dirHandle, 'data/scan-history.tsv', base + '\n' + rows + '\n');
  }

  return { added: addedUrls.size, skipped: skippedCount };
}
