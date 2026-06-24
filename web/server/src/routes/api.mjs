import { Router } from 'express';
import { z } from 'zod';

import { validateBody, validateQuery } from '../middleware/validate.mjs';
import { getCityCodes, getStates } from '../services/data.mjs';
import { ensureDailyMetricsSnapshot, getTaskHistoryTsv } from '../services/history-ledger.mjs';
import { getScriptJob, getScriptResult, startScript, stopScriptJob } from '../services/script-runner.mjs';
import { getAiJob, startAiTask, stopAiJob, claimAgentTask, completeAgentTask, updateAgentProgress, getAiConfig } from '../services/ai-task-runner.mjs';
import { addClient } from '../services/event-bus.mjs';
import { getCdpStatus, launchDebugChrome, openLoginPage } from '../services/cdp-status.mjs';
import { notFound } from '../utils/errors.mjs';

export const apiRouter = Router();

const asyncRoute = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

// ── Middleware ─────────────────────────────────────────────────────────────

apiRouter.use(asyncRoute(async (_request, _response, next) => {
  await ensureDailyMetricsSnapshot();
  next();
}));

// ── System config (read-only, server-side data) ───────────────────────────

apiRouter.get('/config/states', asyncRoute(async (_request, response) => response.json(await getStates())));
apiRouter.get('/config/cities', asyncRoute(async (_request, response) => response.json(await getCityCodes())));

// ── Scripts ───────────────────────────────────────────────────────────────

const scriptQuery = z.object({ sync: z.enum(['true', 'false']).optional() });
const scriptBody = z.object({
  args: z.array(z.string()).default([]),
  dryRun: z.boolean().default(false),
}).strict().default({});

apiRouter.post('/scripts/:name', validateQuery(scriptQuery), validateBody(scriptBody), asyncRoute(async (request, response) => {
  const sync = request.validatedQuery.sync === 'true';
  const result = await startScript(request.params.name, request.validatedBody.args, {
    sync,
    dryRun: request.validatedBody.dryRun,
  });
  response.status(sync ? 200 : 202).json(result);
}));

apiRouter.get('/scripts/:jobId/status', asyncRoute(async (request, response) => {
  response.json(getScriptJob(request.params.jobId));
}));

apiRouter.get('/scripts/:jobId/result', asyncRoute(async (request, response) => {
  const result = getScriptResult(request.params.jobId);
  if (!result) throw notFound('任务结果不可用');
  response.json(result);
}));

apiRouter.delete('/scripts/:jobId', asyncRoute(async (request, response) => {
  response.json(stopScriptJob(request.params.jobId));
}));

// ── CDP status ────────────────────────────────────────────────────────────

const cdpStatusQuery = z.object({ platforms: z.string().optional() });

apiRouter.get('/cdp/status', validateQuery(cdpStatusQuery), asyncRoute(async (request, response) => {
  const platforms = request.validatedQuery.platforms ? request.validatedQuery.platforms.split(',').filter(Boolean) : [];
  response.json(await getCdpStatus(platforms));
}));

apiRouter.post('/cdp/launch', asyncRoute(async (_request, response) => {
  response.json(await launchDebugChrome());
}));

const cdpLoginBody = z.object({ platform: z.string().min(1) });

apiRouter.post('/cdp/open-login', validateBody(cdpLoginBody), asyncRoute(async (request, response) => {
  const result = await openLoginPage(request.validatedBody.platform);
  response.status(result.success ? 200 : 400).json(result);
}));

// ── AI tasks ──────────────────────────────────────────────────────────────

const aiTaskBody = z.object({
  mode: z.string().min(1),
  target: z.string().min(1),
  args: z.record(z.unknown()).optional(),
  userFiles: z.object({
    cv: z.string().optional(),
    profileMode: z.string().optional(),
  }).optional(),
}).strict();

apiRouter.post('/ai-tasks', validateBody(aiTaskBody), asyncRoute(async (request, response) => {
  const result = await startAiTask(request.validatedBody);
  response.status(202).json({ jobId: result.jobId });
}));

apiRouter.get('/ai-tasks/:jobId/status', asyncRoute(async (request, response) => {
  const job = getAiJob(request.params.jobId);
  if (!job) throw notFound(`未找到 AI 任务 ${request.params.jobId}`);
  response.json(job);
}));

apiRouter.delete('/ai-tasks/:jobId', asyncRoute(async (request, response) => {
  const job = stopAiJob(request.params.jobId);
  if (!job) throw notFound(`未找到 AI 任务 ${request.params.jobId}`);
  response.json(job);
}));

apiRouter.get('/ai-tasks/pending', asyncRoute(async (_request, response) => {
  const task = claimAgentTask();
  if (!task) return response.status(204).end();
  response.json(task);
}));

const agentCompleteBody = z.object({
  success: z.boolean(),
  output: z.string().optional(),
  error: z.string().optional(),
}).strict();

apiRouter.post('/ai-tasks/:jobId/complete', validateBody(agentCompleteBody), asyncRoute(async (request, response) => {
  const job = completeAgentTask(request.params.jobId, request.validatedBody);
  if (!job) throw notFound(`未找到 AI 任务 ${request.params.jobId}`);
  response.json(job);
}));

const agentProgressBody = z.object({
  step: z.string(),
  current: z.number(),
  total: z.number(),
}).strict();

apiRouter.post('/ai-tasks/:jobId/progress', validateBody(agentProgressBody), asyncRoute(async (request, response) => {
  const job = updateAgentProgress(request.params.jobId, request.validatedBody);
  if (!job) throw notFound(`未找到 AI 任务 ${request.params.jobId}`);
  response.json(job);
}));

apiRouter.get('/ai-config', (_request, response) => {
  response.json(getAiConfig());
});

// ── Task history ─────────────────────────────────────────────────────────

apiRouter.get('/task-history', asyncRoute(async (_request, response) => {
  const content = await getTaskHistoryTsv();
  response.type('text/tab-separated-values').send(content);
}));

// ── SSE events ────────────────────────────────────────────────────────────

apiRouter.get('/events', (request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
  addClient(response);
  request.on('close', () => response.end());
});
