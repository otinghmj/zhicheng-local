import { useCallback, useEffect, useRef, useState } from 'react';

import { readFile } from '../lib/fs';
import { useFsStore } from '../stores/fsStore';
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

async function loadUserFiles(dirHandle: FileSystemDirectoryHandle | null) {
  if (!dirHandle) return undefined;
  const [cv, profileMode] = await Promise.all([
    readFile(dirHandle, 'cv.md').catch(() => undefined),
    readFile(dirHandle, 'modes/_profile.md').catch(() => undefined),
  ]);
  if (!cv && !profileMode) return undefined;
  return { cv, profileMode };
}

export function useAiTask() {
  const [status, setStatus] = useState<AiTaskStatus>(initial);
  const activeJobId = useRef<string | null>(null);
  const dirHandle = useFsStore((s) => s.dirHandle);

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
      const userFiles = await loadUserFiles(dirHandle);
      const response = await fetch('/api/ai-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, target, args, userFiles }),
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
  }, [dirHandle]);

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
