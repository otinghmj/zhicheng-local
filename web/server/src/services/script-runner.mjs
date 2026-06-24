import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { notFound, conflict, validationError, ApiError } from '../utils/errors.mjs';
import { projectPath } from '../utils/paths.mjs';
import { appendActivity, recordTaskEnd, recordTaskStart } from './history-ledger.mjs';
import { emitJobProgress, emitJobCompleted, emitJobFailed } from './event-bus.mjs';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;
const LOG_TAIL_LINES = 200;
const SYNC_SCRIPTS = new Set(['generate-pdf']);
const LOCAL_ONLY_SCRIPTS = new Set(['generate-pdf']);

const jobs = new Map();
const runningByScript = new Map();
let whitelistPromise;

async function loadWhitelist() {
  whitelistPromise ??= readFile(projectPath('web/server/scripts-whitelist.json'), 'utf8').then(JSON.parse).catch(() => []);
  return whitelistPromise;
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    script: job.script,
    state: job.state,
    progress: job.progress,
    logTail: job.logs.slice(-LOG_TAIL_LINES).join('\n'),
    exitCode: job.exitCode,
    started: job.started,
    ended: job.ended ?? null,
  };
}

function parseProgress(line) {
  if (!line.startsWith('##PROGRESS')) return null;
  try {
    const value = JSON.parse(line.slice('##PROGRESS'.length).trim());
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function consumeLines(job, source, text) {
  const key = `${source}Buffer`;
  job[key] += text;
  const lines = job[key].split(/\r?\n/);
  job[key] = lines.pop() ?? '';
  for (const line of lines) {
    const progress = parseProgress(line);
    if (progress) {
      job.progress = progress;
      emitJobProgress(job.jobId, progress, job.script);
    } else if (line) job.logs.push(source === 'stderr' ? `[stderr] ${line}` : line);
  }
  if (job.logs.length > LOG_TAIL_LINES * 2) job.logs.splice(0, job.logs.length - LOG_TAIL_LINES * 2);
}

function flushBuffers(job) {
  for (const source of ['stdout', 'stderr']) {
    const key = `${source}Buffer`;
    if (job[key]) consumeLines(job, source, '\n');
  }
}

function parseJsonOutput(text) {
  const trimmed = text.trim();
  for (const candidate of [trimmed, trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续尝试从混合日志中提取 JSON。
    }
  }
  throw new ApiError(500, 'SCRIPT_ERROR', '脚本没有返回可解析的 JSON');
}

function finishJob(job, code, signal) {
  if (job.finished) return;
  job.finished = true;
  clearTimeout(job.timeout);
  flushBuffers(job);
  runningByScript.delete(job.script);
  job.ended = new Date().toISOString();
  job.exitCode = Number.isInteger(code) ? code : null;
  job.state = job.cancelRequested ? 'canceled' : job.timedOut ? 'timeout' : code === 0 ? 'completed' : 'failed';
  if (signal) job.logs.push(`进程由信号 ${signal} 结束`);
  void recordTaskEnd(job);
  void appendActivity('job-completed', `${job.script} ${job.state}${job.exitCode === null ? '' : `，退出码 ${job.exitCode}`}`, job.ended);
  if (job.state === 'completed') {
    emitJobCompleted(job.jobId, job.script, job.exitCode);
  } else {
    emitJobFailed(job.jobId, job.script, job.logs.slice(-3).join('\n'));
  }
  job.resolve(publicJob(job));
}

export async function startScript(name, args = [], { sync = false, dryRun = false } = {}) {
  const whitelist = await loadWhitelist();
  const relativeScript = whitelist[name];
  if (!relativeScript) throw notFound(`脚本 ${name} 不在允许执行的名单中`);
  if (runningByScript.has(name)) throw conflict(`脚本 ${name} 正在运行中`, { code: 'SCRIPT_RUNNING' });
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw validationError({ args: '必须是字符串数组' });
  if (sync && !SYNC_SCRIPTS.has(name)) throw validationError({ sync: '该脚本不支持同步执行' });

  const finalArgs = [...args];
  if (dryRun && !finalArgs.includes('--dry-run')) finalArgs.push('--dry-run');
  if (sync && !finalArgs.includes('--json')) finalArgs.push('--json');
  const job = {
    jobId: randomUUID(),
    script: name,
    args: finalArgs,
    state: 'running',
    progress: null,
    logs: [],
    stdout: '',
    stdoutBuffer: '',
    stderrBuffer: '',
    outputBytes: 0,
    started: new Date().toISOString(),
    exitCode: null,
    finished: false,
  };
  job.done = new Promise((resolve) => { job.resolve = resolve; });
  jobs.set(job.jobId, job);
  runningByScript.set(name, job.jobId);

  emitJobProgress(job.jobId, { step: '正在启动', current: 0, total: 1 }, name);

  const child = spawn(process.execPath, [projectPath(relativeScript), ...finalArgs], {
    cwd: projectPath(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  job.child = child;

  const onChunk = (source) => (chunk) => {
    job.outputBytes += chunk.length;
    const text = chunk.toString('utf8');
    if (source === 'stdout') job.stdout += text;
    consumeLines(job, source, text);
    if (job.outputBytes > MAX_OUTPUT_BYTES && !job.finished) {
      job.logs.push('输出超过 10MB，任务已终止');
      job.state = 'failed';
      child.kill('SIGTERM');
    }
  };
  child.stdout.on('data', onChunk('stdout'));
  child.stderr.on('data', onChunk('stderr'));
  child.once('error', (error) => {
    job.logs.push(`[spawn error] ${error.message}`);
    finishJob(job, null);
  });
  child.once('close', (code, signal) => finishJob(job, code, signal));
  job.timeout = setTimeout(() => {
    job.timedOut = true;
    job.logs.push('运行超过 10 分钟，任务已自动终止');
    child.kill('SIGTERM');
  }, TIMEOUT_MS);
  await recordTaskStart(job);

  if (!sync) return publicJob(job);
  await job.done;
  return parseJsonOutput(job.stdout);
}

export function getScriptJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw notFound(`未找到脚本任务 ${jobId}`);
  return publicJob(job);
}

export function getScriptResult(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw notFound(`未找到脚本任务 ${jobId}`);
  if (job.state !== 'completed' || !job.stdout) return null;
  const lines = job.stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{')) {
      try { return JSON.parse(line); } catch { /* continue */ }
    }
  }
  return null;
}

export function stopScriptJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw notFound(`未找到脚本任务 ${jobId}`);
  if (!job.finished) {
    job.cancelRequested = true;
    job.child.kill('SIGTERM');
  }
  return publicJob(job);
}
