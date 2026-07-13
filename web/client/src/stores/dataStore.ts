import { create } from 'zustand';

import type {
  Application,
  EvaluationReportSummary,
  EvaluationReportDetail,
  PipelineItem,
  ScanHistoryEntry,
  StateDefinition,
  StoryBankStory,
  UserProfile,
  PortalConfig,
  ActivityLogEntry,
  MetricsHistoryEntry,
  TaskHistoryEntry,
} from '../types';

interface DataState {
  loading: boolean;
  error: string | null;

  states: StateDefinition[];
  applications: Application[];
  pipeline: { pending: PipelineItem[]; processed: PipelineItem[] };
  reports: EvaluationReportSummary[];
  scanHistory: ScanHistoryEntry[];
  storyBank: StoryBankStory[];
  profile: UserProfile | null;
  portals: PortalConfig | null;
  cvContent: string;
  activityLog: ActivityLogEntry[];
  metricsHistory: MetricsHistoryEntry[];
  taskHistory: TaskHistoryEntry[];

  loadStates: () => Promise<void>;
  loadAll: () => Promise<void>;
  reloadApplications: () => Promise<void>;
  reloadPipeline: () => Promise<void>;
  reloadReports: () => Promise<void>;
  reloadScanHistory: () => Promise<void>;
  reloadStoryBank: () => Promise<void>;
  reloadTaskHistory: () => Promise<void>;
  reloadPortals: () => Promise<void>;

  getReportDetail: (filePath: string) => Promise<EvaluationReportDetail | null>;
}

function parseTsv<T>(content: string, columns: string[]): T[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t');
  if (header.join('\t') === columns.join('\t')) lines.shift();
  return lines.map((line) => {
    const fields = line.split('\t');
    return Object.fromEntries(columns.map((col, i) => [col, fields[i] ?? ''])) as T;
  });
}

function toNum(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function coerceTaskEntry(e: TaskHistoryEntry): TaskHistoryEntry {
  return { ...e, exitCode: toNum(e.exitCode), found: toNum(e.found), dedupRate: toNum(e.dedupRate) };
}

const TASK_COLS = ['taskId', 'script', 'args', 'started', 'ended', 'exitCode', 'found', 'dedupRate'];

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(path);
    if (res.ok) return await res.json() as T;
  } catch { /* API unavailable */ }
  return fallback;
}

async function fetchTaskHistory(): Promise<TaskHistoryEntry[]> {
  try {
    const res = await fetch('/api/task-history');
    if (res.ok) return parseTsv<TaskHistoryEntry>(await res.text(), TASK_COLS).map(coerceTaskEntry);
  } catch { /* server unavailable */ }
  return [];
}

function normalizeMetrics(entries: MetricsHistoryEntry[]): MetricsHistoryEntry[] {
  return (entries ?? []).map((e) => ({
    ...e,
    scanned: Number(e.scanned) || 0,
    pending: Number(e.pending) || 0,
    processed: Number(e.processed) || 0,
    applied: Number(e.applied) || 0,
    interview: Number(e.interview) || 0,
    offers: Number(e.offers) || 0,
  }));
}

export const useDataStore = create<DataState>((set, get) => ({
  loading: true,
  error: null,

  states: [],
  applications: [],
  pipeline: { pending: [], processed: [] },
  reports: [],
  scanHistory: [],
  storyBank: [],
  profile: null,
  portals: null,
  cvContent: '',
  activityLog: [],
  metricsHistory: [],
  taskHistory: [],

  loadStates: async () => {
    const states = await fetchJson<StateDefinition[]>('/api/config/states', []);
    set({ states });
  },

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [
        states,
        applications,
        pipelineData,
        reports,
        scanHistory,
        storyBank,
        profile,
        portals,
        cvData,
        activityLog,
        metricsData,
        taskHistory,
      ] = await Promise.all([
        fetchJson<StateDefinition[]>('/api/config/states', []),
        fetchJson<Application[]>('/api/data/applications', []),
        fetchJson<{ pending: PipelineItem[]; processed: PipelineItem[] }>('/api/data/pipeline', { pending: [], processed: [] }),
        fetchJson<EvaluationReportSummary[]>('/api/data/reports', []),
        fetchJson<ScanHistoryEntry[]>('/api/data/scan-history', []),
        fetchJson<StoryBankStory[]>('/api/data/story-bank', []),
        fetchJson<UserProfile | null>('/api/data/profile', null),
        fetchJson<PortalConfig | null>('/api/data/portals', null),
        fetchJson<{ content: string } | string>('/api/data/cv', { content: '' }),
        fetchJson<ActivityLogEntry[]>('/api/data/history/activity', []),
        fetchJson<MetricsHistoryEntry[]>('/api/data/history/metrics', []),
        fetchTaskHistory(),
      ]);

      set({
        states,
        applications,
        pipeline: { pending: pipelineData.pending ?? [], processed: pipelineData.processed ?? [] },
        reports,
        scanHistory,
        storyBank,
        profile,
        portals,
        cvContent: typeof cvData === 'string' ? cvData : cvData?.content ?? '',
        activityLog: activityLog ?? [],
        metricsHistory: normalizeMetrics(metricsData),
        taskHistory,
        loading: false,
      });
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  reloadApplications: async () => {
    set({ applications: await fetchJson<Application[]>('/api/data/applications', []) });
  },

  reloadPipeline: async () => {
    const data = await fetchJson<{ pending: PipelineItem[]; processed: PipelineItem[] }>('/api/data/pipeline', { pending: [], processed: [] });
    set({ pipeline: { pending: data.pending ?? [], processed: data.processed ?? [] } });
  },

  reloadReports: async () => {
    set({ reports: await fetchJson<EvaluationReportSummary[]>('/api/data/reports', []) });
  },

  reloadScanHistory: async () => {
    set({ scanHistory: await fetchJson<ScanHistoryEntry[]>('/api/data/scan-history', []) });
  },

  reloadStoryBank: async () => {
    set({ storyBank: await fetchJson<StoryBankStory[]>('/api/data/story-bank', []) });
  },

  reloadTaskHistory: async () => {
    set({ taskHistory: await fetchTaskHistory() });
  },

  reloadPortals: async () => {
    set({ portals: await fetchJson<PortalConfig | null>('/api/data/portals', null) });
  },

  getReportDetail: async (filePath) => {
    const num = filePath.match(/^(\d+)/)?.[1] ?? get().reports.find((r) => r.reportPath === filePath)?.num;
    if (num == null) return null;
    try {
      const res = await fetch(`/api/data/reports/${num}?path=${encodeURIComponent(filePath)}`);
      if (res.ok) return await res.json() as EvaluationReportDetail;
    } catch { /* unavailable */ }
    return null;
  },
}));
