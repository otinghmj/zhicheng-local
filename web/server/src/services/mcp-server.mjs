import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { claimAgentTask, completeAgentTask, updateAgentProgress, getCurrentAiJob, setAgentCountProvider, setAgentExecutor, claimOpsTask, completeOpsTask } from './ai-task-runner.mjs';
import { emitAgentChanged } from './event-bus.mjs';

const sessions = new Map();

export async function executeAgentTask(task) {
  for (const [, session] of sessions) {
    try {
      const result = await session.server.server.createMessage({
        messages: [{
          role: 'user',
          content: { type: 'text', text: task.prompt },
        }],
        maxTokens: 16384,
      });
      const text = result.content?.text
        ?? (Array.isArray(result.content) ? result.content.map(c => c.text ?? '').join('') : '')
        ?? '';
      return { success: true, response: text };
    } catch (err) {
      console.error(`[mcp] createMessage failed for job ${task.jobId}:`, err.message);
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: '没有可用的 Agent 连接' };
}

function createMcpServer() {
  const server = new McpServer(
    { name: 'zhicheng', version: '1.0.0' },
    { capabilities: { logging: {}, sampling: {} } },
  );

  server.tool(
    'claim_task',
    '领取待执行的 AI 任务。返回任务详情（含完整 prompt），无任务时返回空。',
    {},
    async () => {
      const task = claimAgentTask();
      if (!task) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'empty', message: '当前没有待执行的任务' }) }] };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: 'claimed',
            jobId: task.jobId,
            mode: task.mode,
            target: task.target,
            args: task.args,
            prompt: task.prompt,
          }),
        }],
      };
    },
  );

  server.tool(
    'complete_task',
    '提交 AI 任务的执行结果。',
    {
      jobId: z.string().describe('任务 ID'),
      success: z.boolean().describe('是否成功'),
      output: z.string().optional().describe('执行输出'),
      error: z.string().optional().describe('错误信息（失败时）'),
    },
    async ({ jobId, success, output, error }) => {
      const result = completeAgentTask(jobId, { success, output, error });
      if (!result) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'not_found', message: `任务 ${jobId} 不存在` }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'completed', state: result.state }) }] };
    },
  );

  server.tool(
    'report_progress',
    '上报 AI 任务执行进度。',
    {
      jobId: z.string().describe('任务 ID'),
      step: z.string().describe('当前步骤描述'),
      current: z.number().describe('当前进度'),
      total: z.number().describe('总步骤数'),
    },
    async ({ jobId, step, current, total }) => {
      const result = updateAgentProgress(jobId, { step, current, total });
      if (!result) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'not_found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'updated', step }) }] };
    },
  );

  server.tool(
    'get_status',
    '查看当前 AI 任务状态。',
    {},
    async () => {
      const job = getCurrentAiJob();
      if (!job) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'idle', message: '当前没有运行中的任务' }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'running', jobId: job.jobId, mode: job.mode, target: job.target, progress: job.progress }) }] };
    },
  );

  // ── Ops tasks (Chrome launch, script execution) ─────────────────────────

  server.tool(
    'claim_ops_task',
    '领取待执行的运维任务（启动 Chrome、执行脚本等）。返回任务详情，无任务时返回空。',
    {},
    async () => {
      const task = claimOpsTask();
      if (!task) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'empty', message: '当前没有待执行的运维任务' }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'claimed', ...task }) }] };
    },
  );

  server.tool(
    'complete_ops_task',
    '提交运维任务的执行结果。',
    {
      jobId: z.string().describe('任务 ID'),
      success: z.boolean().describe('是否成功'),
      result: z.unknown().optional().describe('执行结果（成功时）'),
      error: z.string().optional().describe('错误信息（失败时）'),
    },
    async ({ jobId, success, result, error }) => {
      const job = completeOpsTask(jobId, { success, result, error });
      if (!job) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'not_found' }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'completed', state: job.state }) }] };
    },
  );

  return server;
}

// ── Session management ─────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 25_000;

export function getConnectedAgentCount() {
  return sessions.size;
}

setAgentCountProvider(getConnectedAgentCount);
setAgentExecutor(executeAgentTask);

function startSessionHeartbeat(sessionId) {
  const timer = setInterval(() => {
    const session = sessions.get(sessionId);
    if (!session) { clearInterval(timer); return; }
    try {
      session.server.server.sendLoggingMessage({
        level: 'debug',
        data: 'heartbeat',
      });
    } catch {
      clearInterval(timer);
      cleanupSession(sessionId);
    }
  }, HEARTBEAT_INTERVAL_MS);
  return timer;
}

function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    if (session.heartbeat) clearInterval(session.heartbeat);
    session.transport.close().catch(() => {});
    sessions.delete(sessionId);
    emitAgentChanged(sessions.size);
  }
}

// ── Express handler ────────────────────────────────────────────────────────

export async function handleMcpRequest(req, res) {
  const sessionId = req.headers['mcp-session-id'];

  if (req.method === 'GET') {
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Missing or invalid session ID. Send InitializeRequest first.' });
      return;
    }
    const session = sessions.get(sessionId);
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  if (req.method === 'DELETE') {
    if (sessionId && sessions.has(sessionId)) {
      cleanupSession(sessionId);
    }
    res.status(200).end();
    return;
  }

  // POST — existing session
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // POST — new session: each connection gets its own McpServer instance
  const mcpServer = createMcpServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) cleanupSession(sid);
  };

  await mcpServer.connect(transport);

  await transport.handleRequest(req, res, req.body);

  const newSessionId = transport.sessionId;
  if (newSessionId) {
    const heartbeat = startSessionHeartbeat(newSessionId);
    sessions.set(newSessionId, { transport, server: mcpServer, heartbeat, connectedAt: new Date().toISOString() });
    emitAgentChanged(sessions.size);
  }
}
