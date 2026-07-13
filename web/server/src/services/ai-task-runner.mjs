import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { conflict, validationError } from '../utils/errors.mjs';
import { projectPath } from '../utils/paths.mjs';
import { appendActivity, recordTaskEnd, recordTaskStart } from './history-ledger.mjs';
import { emitJobProgress, emitJobCompleted, emitJobFailed } from './event-bus.mjs';

const AI_TIMEOUT_MS = 15 * 60 * 1000;
const LOG_TAIL_LINES = 300;

let currentAiJob = null;
const aiJobs = new Map();
const pendingAgentTasks = [];

const ALLOWED_MODES = new Set([
  'apply', 'auto-pipeline', 'batch', 'contacto', 'cv-deep-dive',
  'deep', 'deep-prep-glossary', 'deep-prep-immersion', 'deep-prep-portfolio',
  'deep-prep-roleplay', 'deep-prep-simulate', 'interview-prep',
  'oferta', 'ofertas', 'pdf', 'pipeline', 'pre-filter', 'project',
  'scan', 'tracker', 'training',
]);

// ── Shared helpers ─────────────────────────────────────────────────────────

function publicAiJob(job) {
  return {
    jobId: job.jobId,
    script: `ai-task:${job.mode}`,
    state: job.state,
    mode: job.mode,
    target: job.target,
    progress: job.progress,
    logTail: (job.logs ?? []).slice(-LOG_TAIL_LINES).join('\n'),
    exitCode: job.exitCode ?? null,
    started: job.started,
    ended: job.ended ?? null,
    executionMode: job.executionMode,
  };
}

async function buildPrompt(mode, target, args, userFiles) {
  const modeFile = projectPath('modes', `${mode}.md`);
  let modeContent;
  try {
    modeContent = await readFile(modeFile, 'utf8');
  } catch {
    throw validationError({ mode: `modes/${mode}.md 文件不存在` });
  }

  const sharedContent = await readFile(projectPath('modes', '_shared.md'), 'utf8').catch(() => '');
  const profileContent = userFiles?.profileMode ?? await readFile(projectPath('modes', '_profile.md'), 'utf8').catch(() => '');
  const cvContent = userFiles?.cv ?? await readFile(projectPath('cv.md'), 'utf8').catch(() => '');

  const parts = [
    '## 共享上下文',
    sharedContent,
    '',
    '## 用户画像',
    profileContent,
    '',
    '## 简历',
    cvContent,
    '',
    '## 当前模式指令',
    modeContent,
    '',
    '## 任务',
    `模式：${mode}`,
    `目标：${target}`,
  ];

  if (args && Object.keys(args).length) {
    parts.push(`参数：${JSON.stringify(args)}`);
  }

  parts.push('', '请立即执行，不要询问确认。输出产物按模式要求写入对应文件。');

  return parts.join('\n');
}

function finishAiJob(job, success, errorMessage) {
  if (job.finished) return;
  job.finished = true;
  if (job.timeout) clearTimeout(job.timeout);
  job.ended = new Date().toISOString();
  job.exitCode = success ? 0 : 1;
  job.state = job.cancelRequested ? 'canceled' : success ? 'completed' : 'failed';
  if (currentAiJob?.jobId === job.jobId) currentAiJob = null;
  void recordTaskEnd(job);
  void appendActivity('ai-task-completed', `AI 任务 ${job.mode}(${job.target}) ${job.state}`, job.ended);
  if (job.state === 'completed') {
    emitJobCompleted(job.jobId, `ai-task:${job.mode}`, 0);
  } else {
    emitJobFailed(job.jobId, `ai-task:${job.mode}`, errorMessage || '任务执行失败');
  }
  if (job.resolve) job.resolve(publicAiJob(job));
}

function createJob(mode, target, args, executionMode) {
  const job = {
    jobId: randomUUID(),
    script: `ai-task:${mode}`,
    mode,
    target,
    args: args ?? {},
    state: 'running',
    progress: { step: '正在启动', current: 0, total: 1 },
    logs: [],
    started: new Date().toISOString(),
    exitCode: null,
    finished: false,
    executionMode,
  };
  job.done = new Promise((resolve) => { job.resolve = resolve; });
  aiJobs.set(job.jobId, job);
  currentAiJob = job;
  return job;
}

// ── Agent mode: task queue ─────────────────────────────────────────────────

function executeViaAgent(job, prompt) {
  job.progress = { step: '正在推送任务给 Agent', current: 0, total: 1 };
  emitJobProgress(job.jobId, job.progress);

  const task = { jobId: job.jobId, mode: job.mode, target: job.target, prompt };

  // Also push to queue as fallback for manual claiming
  pendingAgentTasks.push({ ...task, args: job.args, created: job.started });

  _executeOnAgent(task).then(result => {
    if (job.finished) return;
    const idx = pendingAgentTasks.findIndex((t) => t.jobId === job.jobId);
    if (idx !== -1) pendingAgentTasks.splice(idx, 1);
    if (result.success) {
      if (result.response) job.logs.push(result.response);
      finishAiJob(job, true);
    } else {
      job.progress = { step: `推送失败: ${result.error}`, current: 0, total: 1 };
      emitJobProgress(job.jobId, job.progress);
    }
  }).catch(() => { /* timeout will handle */ });

  job.timeout = setTimeout(() => {
    if (!job.finished) {
      job.logs.push('Agent 任务执行超时（15分钟）');
      const idx = pendingAgentTasks.findIndex((t) => t.jobId === job.jobId);
      if (idx !== -1) pendingAgentTasks.splice(idx, 1);
      finishAiJob(job, false, 'Agent 任务超时：15分钟内未完成');
    }
  }, AI_TIMEOUT_MS);
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function startAiTask({ mode, target, args, userFiles }) {
  if (!ALLOWED_MODES.has(mode)) throw validationError({ mode: `不在允许列表中：${mode}` });
  if (!target || typeof target !== 'string') throw validationError({ target: '必须提供非空目标' });
  if (currentAiJob) throw conflict('已有 AI 任务正在运行中', { code: 'SCRIPT_RUNNING' });

  if (_getAgentCount() === 0) {
    throw validationError({ agent: '当前没有 Agent 连接。请先在 AI 设置中复制连接提示词发送给你的 Agent（Claude Code / Cursor）。' });
  }

  const prompt = await buildPrompt(mode, target, args, userFiles);
  const job = createJob(mode, target, args, 'agent');

  emitJobProgress(job.jobId, job.progress);
  await recordTaskStart(job);
  executeViaAgent(job, prompt);

  return publicAiJob(job);
}

export function getAiJob(jobId) {
  const job = aiJobs.get(jobId);
  if (!job) return null;
  return publicAiJob(job);
}

export function stopAiJob(jobId) {
  const job = aiJobs.get(jobId);
  if (!job) return null;
  if (!job.finished) {
    job.cancelRequested = true;
    if (job.abortController) job.abortController.abort();
    const idx = pendingAgentTasks.findIndex((t) => t.jobId === jobId);
    if (idx !== -1) pendingAgentTasks.splice(idx, 1);
    finishAiJob(job, false, '任务已取消');
  }
  return publicAiJob(job);
}

export function getCurrentAiJob() {
  return currentAiJob ? publicAiJob(currentAiJob) : null;
}

// ── Agent mode endpoints ───────────────────────────────────────────────────

export function claimAgentTask() {
  const task = pendingAgentTasks.shift();
  if (!task) return null;

  const job = aiJobs.get(task.jobId);
  if (job && !job.finished) {
    job.progress = { step: 'Agent 已领取，正在执行', current: 0, total: 1 };
    emitJobProgress(job.jobId, job.progress);
  }

  return task;
}

export function updateAgentProgress(jobId, progress) {
  const job = aiJobs.get(jobId);
  if (!job || job.finished) return null;
  job.progress = progress;
  emitJobProgress(job.jobId, progress);
  return publicAiJob(job);
}

export function completeAgentTask(jobId, { success, output, error }) {
  const job = aiJobs.get(jobId);
  if (!job) return null;
  if (job.finished) return publicAiJob(job);

  if (output) job.logs.push(output);
  finishAiJob(job, success, error);
  return publicAiJob(job);
}

let _getAgentCount = () => 0;
export function setAgentCountProvider(fn) { _getAgentCount = fn; }

let _executeOnAgent = async () => ({ success: false, error: 'no executor configured' });
export function setAgentExecutor(fn) { _executeOnAgent = fn; }

export function getAiConfig() {
  const port = process.env.SERVER_PORT ?? 3200;
  const mcpUrl = process.env.MCP_PUBLIC_URL || `http://localhost:${port}/mcp`;
  return { agentConnections: _getAgentCount(), mcpUrl };
}
