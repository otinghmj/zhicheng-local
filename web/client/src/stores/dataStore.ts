import { create } from 'zustand';
import YAML from 'yaml';

import { readFile, readFileOrDefault, listFiles, writeFile } from '../lib/fs';
import { parseApplications } from '../parsers/applications';
import { parsePipeline } from '../parsers/pipeline';
import { parseReportSummary, parseReportDetail } from '../parsers/reports';
import { parseScanHistory } from '../parsers/scan-history';
import { parseStoryBank } from '../parsers/story-bank';

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
import type { ParseFailure } from '../parsers/shared';

type MaybeHandle = FileSystemDirectoryHandle | null | undefined;

interface DataState {
  loading: boolean;
  error: string | null;

  states: StateDefinition[];
  applications: Application[];
  parseErrors: ParseFailure[];
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
  loadAll: (handle: MaybeHandle) => Promise<void>;
  reloadApplications: (handle: MaybeHandle) => Promise<void>;
  reloadPipeline: (handle: MaybeHandle) => Promise<void>;
  reloadReports: (handle: MaybeHandle) => Promise<void>;
  reloadScanHistory: (handle: MaybeHandle) => Promise<void>;
  reloadStoryBank: (handle: MaybeHandle) => Promise<void>;
  reloadTaskHistory: (handle?: MaybeHandle) => Promise<void>;
  reloadPortals: (handle: MaybeHandle) => Promise<void>;

  getReportDetail: (handle: MaybeHandle, filePath: string) => Promise<EvaluationReportDetail | null>;
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

async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(path);
    if (res.ok) return await res.json() as T;
  } catch { /* API unavailable */ }
  return fallback;
}

async function loadReportsFromDir(
  handle: FileSystemDirectoryHandle,
  prefix = '',
): Promise<EvaluationReportSummary[]> {
  const results: EvaluationReportSummary[] = [];
  for await (const entry of handle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      const subDir = await handle.getDirectoryHandle(entry.name);
      results.push(...await loadReportsFromDir(subDir, path));
    } else if (entry.kind === 'file' && entry.name.endsWith('.md')) {
      try {
        const fileHandle = await handle.getFileHandle(entry.name);
        const file = await fileHandle.getFile();
        const content = await file.text();
        const report = parseReportSummary(content, { filePath: path });
        if (!('ok' in report && report.ok === false)) {
          results.push(report as EvaluationReportSummary);
        }
      } catch { /* skip unreadable files */ }
    }
  }
  return results;
}

export const useDataStore = create<DataState>((set, get) => ({
  loading: true,
  error: null,

  states: [],
  applications: [],
  parseErrors: [],
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
    try {
      const res = await fetch('/api/config/states');
      if (res.ok) {
        const data = await res.json() as StateDefinition[];
        set({ states: data });
      }
    } catch { /* states stay empty, parsing degrades gracefully */ }
  },

  loadAll: async (handle) => {
    set({ loading: true, error: null });
    try {
      await get().loadStates();
      if (handle) {
        await loadAllFromFs(handle, get, set);
      } else {
        await loadAllFromApi(get, set);
      }
    } catch (e: unknown) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  reloadApplications: async (handle) => {
    if (!handle) {
      const applications = await fetchJson<Application[]>('/api/data/applications', []);
      set({ applications, parseErrors: [] });
      return;
    }
    const states = get().states;
    const content = await readFileOrDefault(handle, 'data/applications.md', '');
    const parsed = parseApplications(content, { states });
    set({
      applications: parsed.filter((r): r is Application => !('ok' in r && r.ok === false)),
      parseErrors: parsed.filter((r): r is ParseFailure => 'ok' in r && r.ok === false),
    });
  },

  reloadPipeline: async (handle) => {
    if (!handle) {
      const data = await fetchJson<{ pending: PipelineItem[]; processed: PipelineItem[] }>('/api/data/pipeline', { pending: [], processed: [] });
      set({ pipeline: { pending: data.pending ?? [], processed: data.processed ?? [] } });
      return;
    }
    const content = await readFileOrDefault(handle, 'data/pipeline.md', '');
    const items = parsePipeline(content);
    set({
      pipeline: {
        pending: items.filter((i) => 'ok' in i && i.ok && !i.processed),
        processed: items.filter((i) => 'ok' in i && i.ok && i.processed),
      },
    });
  },

  reloadReports: async (handle) => {
    if (!handle) {
      const reports = await fetchJson<EvaluationReportSummary[]>('/api/data/reports', []);
      set({ reports });
      return;
    }
    try {
      const reportsDir = await handle.getDirectoryHandle('reports');
      const reports = await loadReportsFromDir(reportsDir);
      set({ reports });
    } catch {
      set({ reports: [] });
    }
  },

  reloadScanHistory: async (handle) => {
    if (!handle) {
      const scanHistory = await fetchJson<ScanHistoryEntry[]>('/api/data/scan-history', []);
      set({ scanHistory });
      return;
    }
    const content = await readFileOrDefault(handle, 'data/scan-history.tsv', '');
    const parsed = parseScanHistory(content);
    set({ scanHistory: parsed.filter((r): r is ScanHistoryEntry => !('ok' in r && r.ok === false)) });
  },

  reloadStoryBank: async (handle) => {
    if (!handle) {
      const storyBank = await fetchJson<StoryBankStory[]>('/api/data/story-bank', []);
      set({ storyBank });
      return;
    }
    try {
      const content = await readFile(handle, 'interview-prep/story-bank.md');
      const parsed = parseStoryBank(content);
      set({ storyBank: parsed.filter((r): r is StoryBankStory => !('ok' in r && r.ok === false)) });
    } catch {
      set({ storyBank: [] });
    }
  },

  reloadTaskHistory: async (handle) => {
    const cols: string[] = ['taskId', 'script', 'args', 'started', 'ended', 'exitCode', 'found', 'dedupRate'];
    let serverEntries: TaskHistoryEntry[] = [];
    try {
      const res = await fetch('/api/task-history');
      if (res.ok) serverEntries = parseTsv<TaskHistoryEntry>(await res.text(), cols).map(coerceTaskEntry);
    } catch { /* server unavailable */ }

    let localEntries: TaskHistoryEntry[] = [];
    if (handle) {
      const local = await readFileOrDefault(handle, 'data/task-history.tsv', '');
      if (local) localEntries = parseTsv<TaskHistoryEntry>(local, cols).map(coerceTaskEntry);
    }

    const seen = new Set(serverEntries.map((e) => e.taskId));
    const merged = [...serverEntries, ...localEntries.filter((e) => !seen.has(e.taskId))];
    set({ taskHistory: merged });
  },

  reloadPortals: async (handle) => {
    if (!handle) {
      const portals = await fetchJson<PortalConfig | null>('/api/data/portals', null);
      set({ portals });
      return;
    }
    try {
      const content = await readFile(handle, 'portals.yml');
      set({ portals: YAML.parse(content) as PortalConfig });
    } catch {
      set({ portals: null });
    }
  },

  getReportDetail: async (handle, filePath) => {
    if (!handle) {
      const num = filePath.match(/^(\d+)/)?.[1];
      if (!num) return null;
      try {
        const res = await fetch(`/api/data/reports/${num}?path=${encodeURIComponent(filePath)}`);
        if (res.ok) return await res.json() as EvaluationReportDetail;
      } catch { /* unavailable */ }
      return null;
    }
    try {
      const content = await readFile(handle, `reports/${filePath}`);
      const detail = parseReportDetail(content, { filePath });
      if ('ok' in detail && detail.ok === false) return null;
      return detail as EvaluationReportDetail;
    } catch {
      return null;
    }
  },

}));

async function loadAllFromFs(
  handle: FileSystemDirectoryHandle,
  get: () => DataState,
  set: (partial: Partial<DataState>) => void,
) {
  const states = get().states;

  const appContent = await readFileOrDefault(handle, 'data/applications.md', '');
  const parsed = parseApplications(appContent, { states });
  const applications = parsed.filter((r): r is Application => !('ok' in r && r.ok === false));
  const parseErrors = parsed.filter((r): r is ParseFailure => 'ok' in r && r.ok === false);

  const pipeContent = await readFileOrDefault(handle, 'data/pipeline.md', '');
  const pipeItems = parsePipeline(pipeContent);
  const pending = pipeItems.filter((i) => 'ok' in i && i.ok && !i.processed);
  const processed = pipeItems.filter((i) => 'ok' in i && i.ok && i.processed);

  let reports: EvaluationReportSummary[] = [];
  try {
    const reportsDir = await handle.getDirectoryHandle('reports');
    reports = await loadReportsFromDir(reportsDir);
  } catch { /* no reports dir yet */ }

  const scanContent = await readFileOrDefault(handle, 'data/scan-history.tsv', '');
  const scanParsed = parseScanHistory(scanContent);
  const scanHistory = scanParsed.filter((r): r is ScanHistoryEntry => !('ok' in r && r.ok === false));

  let storyBank: StoryBankStory[] = [];
  try {
    const storyContent = await readFile(handle, 'interview-prep/story-bank.md');
    const storyParsed = parseStoryBank(storyContent);
    storyBank = storyParsed.filter((r): r is StoryBankStory => !('ok' in r && r.ok === false));
  } catch { /* no story bank yet */ }

  let profile: UserProfile | null = null;
  try {
    const profileContent = await readFile(handle, 'config/profile.yml');
    profile = YAML.parse(profileContent) as UserProfile;
  } catch { /* no profile yet */ }

  let portals: PortalConfig | null = null;
  try {
    const portalsContent = await readFile(handle, 'portals.yml');
    portals = YAML.parse(portalsContent) as PortalConfig;
  } catch { /* no portals config yet */ }

  const cvContent = await readFileOrDefault(handle, 'cv.md', '');

  const activityContent = await readFileOrDefault(handle, 'data/activity-log.tsv', '');
  const activityLog = parseTsv<ActivityLogEntry>(activityContent, ['ts', 'type', 'summary']);

  const metricsContent = await readFileOrDefault(handle, 'data/metrics-history.tsv', '');
  const metricsHistory = parseTsv<MetricsHistoryEntry>(metricsContent, [
    'date', 'scanned', 'pending', 'processed', 'applied', 'interview', 'offers',
  ]).map((e) => ({
    ...e,
    scanned: Number(e.scanned) || 0,
    pending: Number(e.pending) || 0,
    processed: Number(e.processed) || 0,
    applied: Number(e.applied) || 0,
    interview: Number(e.interview) || 0,
    offers: Number(e.offers) || 0,
  }));

  const taskCols: string[] = ['taskId', 'script', 'args', 'started', 'ended', 'exitCode', 'found', 'dedupRate'];
  let serverTaskEntries: TaskHistoryEntry[] = [];
  try {
    const taskRes = await fetch('/api/task-history');
    if (taskRes.ok) serverTaskEntries = parseTsv<TaskHistoryEntry>(await taskRes.text(), taskCols).map(coerceTaskEntry);
  } catch { /* server unavailable */ }
  const localTaskEntries = parseTsv<TaskHistoryEntry>(
    await readFileOrDefault(handle, 'data/task-history.tsv', ''), taskCols,
  ).map(coerceTaskEntry);
  const taskSeen = new Set(serverTaskEntries.map((e) => e.taskId));
  const taskHistory = [...serverTaskEntries, ...localTaskEntries.filter((e) => !taskSeen.has(e.taskId))];

  set({
    applications,
    parseErrors,
    pipeline: { pending, processed },
    reports,
    scanHistory,
    storyBank,
    profile,
    portals,
    cvContent,
    activityLog,
    metricsHistory,
    taskHistory,
    loading: false,
  });
}

async function loadAllFromApi(
  get: () => DataState,
  set: (partial: Partial<DataState>) => void,
) {
  const [
    applications,
    pipelineData,
    reports,
    scanHistory,
    storyBank,
    profile,
    portals,
    cvData,
    activityData,
    metricsData,
  ] = await Promise.all([
    fetchJson<Application[]>('/api/data/applications', []),
    fetchJson<{ pending: PipelineItem[]; processed: PipelineItem[] }>('/api/data/pipeline', { pending: [], processed: [] }),
    fetchJson<EvaluationReportSummary[]>('/api/data/reports', []),
    fetchJson<ScanHistoryEntry[]>('/api/data/scan-history', []),
    fetchJson<StoryBankStory[]>('/api/data/story-bank', []),
    fetchJson<UserProfile | null>('/api/data/profile', null),
    fetchJson<PortalConfig | null>('/api/data/portals', null),
    fetchJson<{ content: string }>('/api/data/cv', { content: '' }),
    fetchJson<ActivityLogEntry[]>('/api/data/history/activity', []),
    fetchJson<MetricsHistoryEntry[]>('/api/data/history/metrics', []),
  ]);

  const taskCols: string[] = ['taskId', 'script', 'args', 'started', 'ended', 'exitCode', 'found', 'dedupRate'];
  let taskHistory: TaskHistoryEntry[] = [];
  try {
    const taskRes = await fetch('/api/task-history');
    if (taskRes.ok) taskHistory = parseTsv<TaskHistoryEntry>(await taskRes.text(), taskCols).map(coerceTaskEntry);
  } catch { /* server unavailable */ }

  const metricsHistory = (metricsData ?? []).map((e: MetricsHistoryEntry) => ({
    ...e,
    scanned: Number(e.scanned) || 0,
    pending: Number(e.pending) || 0,
    processed: Number(e.processed) || 0,
    applied: Number(e.applied) || 0,
    interview: Number(e.interview) || 0,
    offers: Number(e.offers) || 0,
  }));

  set({
    applications,
    parseErrors: [],
    pipeline: { pending: pipelineData.pending ?? [], processed: pipelineData.processed ?? [] },
    reports,
    scanHistory,
    storyBank,
    profile,
    portals,
    cvContent: typeof cvData === 'string' ? cvData : (cvData as { content?: string })?.content ?? '',
    activityLog: activityData ?? [],
    metricsHistory,
    taskHistory,
    loading: false,
  });
}
