import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CloseOutlined,
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons';

import { useSSEHandler } from '../../hooks/useSSE';
import type { SSEEventData, SSEProgressPayload } from '../../hooks/useSSE';

type TaskState = 'idle' | 'running' | 'completed' | 'failed';

interface TaskInfo {
  jobId: string;
  script: string;
  state: TaskState;
  progress: SSEProgressPayload | null;
  error: string | null;
  logs: string[];
  startedAt: number;
}

interface Toast {
  id: string;
  type: 'info' | 'success' | 'error';
  text: string;
}

const MODE_LABELS: Record<string, string> = {
  'ai-task:oferta': '评估报告',
  'ai-task:ofertas': '多项对比',
  'ai-task:pdf': '生成 PDF',
  'ai-task:scan': '扫描职位',
  'ai-task:pipeline': '处理队列',
  'ai-task:deep': '深度调研',
  'ai-task:contacto': 'LinkedIn 联络',
  'ai-task:interview-prep': '面试准备',
  'ai-task:training': '培训评估',
  'ai-task:project': '项目评估',
  'ai-task:apply': '投递助手',
  'ai-task:tracker': '状态追踪',
  'merge': '合并跟踪记录',
  'verify': '校验队列',
  'normalize': '状态标准化',
  'dedup': '去重跟踪记录',
  'doctor': '环境检查',
  'pdf': '生成 PDF',
  '51job-opencli': '前程无忧采集',
  'liepin-dom': '猎聘采集',
  'pipeline-process': '队列处理',
  'sync-check': 'CV 同步检查',
};

const FILE_LABELS: Record<string, string> = {
  'data/applications.md': '投递记录',
  'data/pipeline.md': '待处理队列',
  'config/profile.yml': '用户配置',
  'portals.yml': '门户配置',
  'cv.md': '简历',
  'modes/_profile.md': '用户画像',
};

let toastSeq = 0;

function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function TaskStatusBar() {
  const [task, setTask] = useState<TaskInfo | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>();
  const logEndRef = useRef<HTMLDivElement>(null);

  // ── Toast helpers ──────────────────────────────────────────────────────
  const pushToast = useCallback((type: Toast['type'], text: string) => {
    const id = `toast-${++toastSeq}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── SSE: external file changes ─────────────────────────────────────────
  const onExternalChange = useCallback((data: SSEEventData) => {
    const file = data.file ?? data.filename ?? '未知文件';
    const label = FILE_LABELS[file] ?? file;
    pushToast('info', `${label} 已被外部修改`);
  }, [pushToast]);

  useSSEHandler('external-change', onExternalChange);

  // ── SSE: task progress ─────────────────────────────────────────────────
  const onProgress = useCallback((data: SSEEventData) => {
    if (!data.jobId || !data.progress) return;
    setTask((prev) => {
      if (!prev || prev.jobId !== data.jobId) {
        return {
          jobId: data.jobId!,
          script: data.script ?? '',
          state: 'running',
          progress: data.progress!,
          error: null,
          logs: [`[${new Date().toLocaleTimeString()}] ${data.progress!.step}`],
          startedAt: Date.now(),
        };
      }
      const newLog = `[${new Date().toLocaleTimeString()}] ${data.progress!.step}`;
      const logs = prev.logs[prev.logs.length - 1] === newLog ? prev.logs : [...prev.logs, newLog];
      return { ...prev, progress: data.progress!, logs };
    });
  }, []);

  const onCompleted = useCallback((data: SSEEventData) => {
    if (!data.jobId) return;
    setTask((prev) => {
      const ts = `[${new Date().toLocaleTimeString()}]`;
      if (prev && prev.jobId === data.jobId) {
        return {
          ...prev,
          state: 'completed',
          progress: { step: '完成', current: 1, total: 1 },
          logs: [...prev.logs, `${ts} ✓ 任务完成`],
        };
      }
      return {
        jobId: data.jobId!,
        script: data.script ?? '',
        state: 'completed',
        progress: { step: '完成', current: 1, total: 1 },
        error: null,
        logs: [`${ts} ✓ 任务完成`],
        startedAt: Date.now(),
      };
    });
  }, []);

  const onFailed = useCallback((data: SSEEventData) => {
    if (!data.jobId) return;
    setTask((prev) => {
      const ts = `[${new Date().toLocaleTimeString()}]`;
      const errMsg = data.error ?? '执行失败';
      if (prev && prev.jobId === data.jobId) {
        return {
          ...prev,
          state: 'failed',
          error: errMsg,
          logs: [...prev.logs, `${ts} ✗ ${errMsg}`],
        };
      }
      return {
        jobId: data.jobId!,
        script: data.script ?? '',
        state: 'failed',
        progress: null,
        error: errMsg,
        logs: [`${ts} ✗ ${errMsg}`],
        startedAt: Date.now(),
      };
    });
  }, []);

  useSSEHandler('script-progress', onProgress);
  useSSEHandler('script-completed', onCompleted);
  useSSEHandler('script-failed', onFailed);

  // Elapsed timer
  useEffect(() => {
    if (!task || task.state !== 'running') return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - task.startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [task?.state, task?.startedAt]);

  // Auto-dismiss after completion
  useEffect(() => {
    if (task?.state === 'completed') {
      dismissTimer.current = setTimeout(() => setTask(null), 8000);
      return () => clearTimeout(dismissTimer.current);
    }
  }, [task?.state]);

  // Scroll log to bottom
  useEffect(() => {
    if (expanded) logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [task?.logs.length, expanded]);

  if (!task && toasts.length === 0) return null;

  const pct = task?.progress ? Math.round((task.progress.current / Math.max(task.progress.total, 1)) * 100) : 0;
  const label = task ? (MODE_LABELS[task.script] ?? task.script.replace('ai-task:', '') ?? 'AI 任务') : '';
  const isTerminal = task?.state === 'completed' || task?.state === 'failed';

  return (
    <div className="task-bar-stack">
      {/* Toast notifications */}
      {toasts.map((t) => (
        <div key={t.id} className="task-toast" data-type={t.type}>
          <span className="task-toast__icon">
            {t.type === 'info' && <FileTextOutlined />}
            {t.type === 'success' && <CheckCircleOutlined />}
            {t.type === 'error' && <CloseCircleOutlined />}
          </span>
          <span className="task-toast__text">{t.text}</span>
          <button className="task-bar__close" onClick={() => dismissToast(t.id)}>
            <CloseOutlined />
          </button>
        </div>
      ))}

      {/* Task progress bar */}
      {task && (
        <div className="task-bar" data-state={task.state}>
          <div className="task-bar__main" onClick={() => setExpanded(!expanded)}>
            <span className="task-bar__icon">
              {task.state === 'running' && <LoadingOutlined spin />}
              {task.state === 'completed' && <CheckCircleOutlined />}
              {task.state === 'failed' && <CloseCircleOutlined />}
            </span>

            <span className="task-bar__label">{label}</span>

            <span className="task-bar__step">{task.progress?.step ?? ''}</span>

            <div className="task-bar__progress">
              <div className="task-bar__progress-fill" style={{ width: `${pct}%` }} />
            </div>

            <span className="task-bar__time">{task.state === 'running' ? formatElapsed(elapsed) : ''}</span>

            {isTerminal && (
              <button className="task-bar__close" onClick={(e) => { e.stopPropagation(); setTask(null); }}>
                <CloseOutlined />
              </button>
            )}
          </div>

          {expanded && (
            <div className="task-bar__logs">
              {task.logs.map((line, i) => (
                <div key={i} className="task-bar__log-line">{line}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
