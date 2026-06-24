import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { projectPath } from '../utils/paths.mjs';
import { getApplications, getPipeline, getScanHistory } from './data.mjs';
import { exists } from './files.mjs';

const PATHS = {
  task: projectPath('data/task-history.tsv'),
  metrics: projectPath('data/metrics-history.tsv'),
  activity: projectPath('data/activity-log.tsv'),
};

const HEADERS = {
  task: 'task_id\tscript\targs\tstarted\tended\texit_code\tfound\tdedup_rate\n',
  metrics: 'date\tscanned\tpending\tprocessed\tapplied\tinterview\toffers\n',
  activity: 'ts\ttype\tsummary\n',
};

let writeQueue = Promise.resolve();

function serialWrite(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => {});
  return next;
}

function clean(value) {
  return String(value ?? '').replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
}

async function ensureFile(kind) {
  const filePath = PATHS[kind];
  await mkdir(dirname(filePath), { recursive: true });
  if (!await exists(filePath)) await writeFile(filePath, HEADERS[kind], 'utf8');
  return filePath;
}

export function appendActivity(type, summary, ts = new Date().toISOString()) {
  return serialWrite(async () => {
    const filePath = await ensureFile('activity');
    await appendFile(filePath, `${clean(ts)}\t${clean(type)}\t${clean(summary)}\n`, 'utf8');
  });
}

export function recordTaskStart(job) {
  return serialWrite(async () => {
    const filePath = await ensureFile('task');
    const args = Array.isArray(job.args) ? job.args.map((arg) => JSON.stringify(arg)).join(' ') : JSON.stringify(job.args ?? {});
    await appendFile(filePath, `${clean(job.jobId)}\t${clean(job.script)}\t${clean(args)}\t${clean(job.started)}\t\t\t\t\n`, 'utf8');
  });
}

export function recordTaskEnd(job) {
  return serialWrite(async () => {
    const filePath = await ensureFile('task');
    const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
    const index = lines.findIndex((line) => line.split('\t')[0] === job.jobId);
    if (index < 0) return;
    const fields = lines[index].split('\t');
    fields[4] = clean(job.ended);
    fields[5] = clean(job.exitCode);
    fields[6] = clean(job.progress?.found);
    fields[7] = clean(job.progress?.dedupRate ?? job.progress?.dedup_rate);
    lines[index] = fields.join('\t');
    const temporary = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');
    await rename(temporary, filePath);
  });
}

function shanghaiDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

export async function getTaskHistoryTsv() {
  const filePath = PATHS.task;
  if (!await exists(filePath)) return '';
  return readFile(filePath, 'utf8');
}

export function ensureDailyMetricsSnapshot() {
  return serialWrite(async () => {
    const filePath = await ensureFile('metrics');
    const date = shanghaiDate();
    const current = await readFile(filePath, 'utf8');
    if (current.split(/\r?\n/).some((line) => line.startsWith(`${date}\t`))) return;

    const [scanHistory, pipeline, applications] = await Promise.all([
      getScanHistory(),
      getPipeline(),
      getApplications(),
    ]);
    const count = (status) => applications.filter((item) => item.status === status).length;
    const applied = applications.filter((item) => ['Applied', 'Responded', 'Interview', 'Offer'].includes(item.status)).length;
    await appendFile(
      filePath,
      `${date}\t${scanHistory.length}\t${pipeline.pendingCount}\t${pipeline.processedCount}\t${applied}\t${count('Interview')}\t${count('Offer')}\n`,
      'utf8',
    );
  });
}
