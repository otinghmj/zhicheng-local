import { useEffect, useRef, useCallback } from 'react';

export type SSEEventType =
  | 'applications-updated'
  | 'pipeline-updated'
  | 'config-updated'
  | 'report-added'
  | 'batch-updated'
  | 'script-progress'
  | 'script-completed'
  | 'script-failed'
  | 'external-change'
  | 'agent-changed';

export type SSEProgressPayload = {
  step: string;
  current: number;
  total: number;
  found?: number;
};

export type SSEEventData = {
  timestamp?: string;
  ts?: string;
  filename?: string;
  file?: string;
  type?: string;
  jobId?: string;
  script?: string;
  progress?: SSEProgressPayload;
  exitCode?: number | null;
  error?: string;
  agentConnections?: number;
};

type SSEHandler = (data: SSEEventData) => void;
type SSEHandlers = Partial<Record<SSEEventType, SSEHandler>>;

const MAX_RETRY_DELAY = 30_000;
const INITIAL_RETRY_DELAY = 1_000;

let globalES: EventSource | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Map<SSEEventType, Set<SSEHandler>>();

const ALL_EVENTS: SSEEventType[] = [
  'applications-updated',
  'pipeline-updated',
  'config-updated',
  'report-added',
  'batch-updated',
  'script-progress',
  'script-completed',
  'script-failed',
  'external-change',
  'agent-changed',
];

function dispatch(eventType: SSEEventType, data: SSEEventData) {
  listeners.get(eventType)?.forEach((fn) => {
    try { fn(data); } catch { /* handler error */ }
  });
}

function connect() {
  if (globalES) return;

  const es = new EventSource('/api/events');
  globalES = es;

  es.onopen = () => {
    const wasReconnect = reconnectAttempt > 0;
    reconnectAttempt = 0;
    if (wasReconnect) {
      dispatch('applications-updated', { timestamp: new Date().toISOString() });
      dispatch('pipeline-updated', { timestamp: new Date().toISOString() });
      dispatch('config-updated', { timestamp: new Date().toISOString() });
    }
  };

  for (const eventType of ALL_EVENTS) {
    es.addEventListener(eventType, ((event: MessageEvent) => {
      try {
        dispatch(eventType, JSON.parse(event.data) as SSEEventData);
      } catch { /* malformed */ }
    }) as EventListener);
  }

  es.onerror = () => {
    es.close();
    globalES = null;
    const attempt = reconnectAttempt++;
    const delay = Math.min(INITIAL_RETRY_DELAY * 2 ** attempt, MAX_RETRY_DELAY);
    reconnectTimer = setTimeout(connect, delay);
  };
}

function disconnect() {
  clearTimeout(reconnectTimer);
  globalES?.close();
  globalES = null;
  reconnectAttempt = 0;
}

function subscribe(eventType: SSEEventType, handler: SSEHandler) {
  let set = listeners.get(eventType);
  if (!set) {
    set = new Set();
    listeners.set(eventType, set);
  }
  set.add(handler);
}

function unsubscribe(eventType: SSEEventType, handler: SSEHandler) {
  listeners.get(eventType)?.delete(handler);
}

export function useSSEConnection() {
  useEffect(() => {
    connect();
    return () => {
      let total = 0;
      listeners.forEach((set) => { total += set.size; });
      if (total === 0) disconnect();
    };
  }, []);
}

export function useSSE(handlers: SSEHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const stableHandlers = useRef(new Map<SSEEventType, SSEHandler>());

  useEffect(() => {
    const entries = Object.entries(handlersRef.current) as [SSEEventType, SSEHandler][];
    for (const [eventType, handler] of entries) {
      const wrapper: SSEHandler = (data) => handlersRef.current[eventType]?.(data);
      stableHandlers.current.set(eventType, wrapper);
      subscribe(eventType, wrapper);
    }
    connect();
    return () => {
      stableHandlers.current.forEach((wrapper, eventType) => {
        unsubscribe(eventType, wrapper);
      });
      stableHandlers.current.clear();
    };
  }, []);
}

export function useSSEHandler(eventType: SSEEventType, handler: SSEHandler) {
  const ref = useRef(handler);
  ref.current = handler;

  const wrapper = useCallback((data: SSEEventData) => ref.current(data), []);

  useEffect(() => {
    subscribe(eventType, wrapper);
    connect();
    return () => { unsubscribe(eventType, wrapper); };
  }, [eventType, wrapper]);
}
