import { useCallback, useEffect, useRef, useState } from 'react';

import { useSSEHandler } from './useSSE';
import type { SSEEventData, SSEProgressPayload } from './useSSE';

export type AiTaskState = 'idle' | 'running' | 'completed' | 'failed' | 'canceled';

export interface AiTaskStatus {
  jobId: string | null;
  state: AiTaskState;
  progress: SSEProgressPayload | null;
  error: string | null;
}

export interface AiConfig {
  agentConnections: number;
  mcpUrl: string;
}

const initial: AiTaskStatus = { jobId: null, state: 'idle', progress: null, error: null };

export function useAiConfig() {
  const [config, setConfig] = useState<AiConfig | null>(null);

  const refresh = useCallback(() => {
    fetch('/api/ai-config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onAgentChanged = useCallback((data: SSEEventData) => {
    if (data.agentConnections !== undefined) {
      setConfig((prev) => prev ? { ...prev, agentConnections: data.agentConnections! } : prev);
    }
  }, []);

  useSSEHandler('agent-changed', onAgentChanged);

  return { config, refresh };
}

export function useAiTask() {
  const [status, setStatus] = useState<AiTaskStatus>(initial);
  const activeJobId = useRef<string | null>(null);

  const onProgress = useCallback((data: SSEEventData) => {
    if (data.jobId && data.jobId === activeJobId.current && data.progress) {
      setStatus((prev) => ({ ...prev, progress: data.progress! }));
    }
  }, []);

  const onCompleted = useCallback((data: SSEEventData) => {
    if (data.jobId && data.jobId === activeJobId.current) {
      setStatus((prev) => ({ ...prev, state: 'completed', progress: null }));
      activeJobId.current = null;
    }
  }, []);

  const onFailed = useCallback((data: SSEEventData) => {
    if (data.jobId && data.jobId === activeJobId.current) {
      setStatus((prev) => ({ ...prev, state: 'failed', error: data.error ?? '任务执行失败', progress: null }));
      activeJobId.current = null;
    }
  }, []);

  useSSEHandler('script-progress', onProgress);
  useSSEHandler('script-completed', onCompleted);
  useSSEHandler('script-failed', onFailed);

  const start = useCallback(async (mode: string, target: string, args?: Record<string, unknown>): Promise<{ jobId: string } | { error: string }> => {
    setStatus({ jobId: null, state: 'running', progress: { step: '正在启动', current: 0, total: 1 }, error: null });
    try {
      // 用户文件（cv.md / modes/_profile.md）由服务端从磁盘读取，前端不再传。
      const response = await fetch('/api/ai-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, target, args }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string; details?: Record<string, string> };
        const errorMsg = (body.details ? Object.values(body.details).join('; ') : null) || body.error || `请求失败：${response.status}`;
        setStatus({ jobId: null, state: 'failed', progress: null, error: errorMsg });
        return { error: errorMsg };
      }
      const { jobId } = await response.json() as { jobId: string };
      activeJobId.current = jobId;
      setStatus((prev) => ({ ...prev, jobId }));
      return { jobId };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '网络错误';
      setStatus({ jobId: null, state: 'failed', progress: null, error: errorMsg });
      return { error: errorMsg };
    }
  }, []);

  const cancel = useCallback(async () => {
    const jobId = activeJobId.current;
    if (!jobId) return;
    try {
      await fetch(`/api/ai-tasks/${jobId}`, { method: 'DELETE' });
      setStatus((prev) => ({ ...prev, state: 'canceled', progress: null }));
      activeJobId.current = null;
    } catch { /* ignore */ }
  }, []);

  const reset = useCallback(() => {
    activeJobId.current = null;
    setStatus(initial);
  }, []);

  return { status, start, cancel, reset };
}
