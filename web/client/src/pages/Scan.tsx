import {
  BulbOutlined,
  ChromeOutlined,
  DeleteOutlined,
  FundProjectionScreenOutlined,
  HistoryOutlined,
  LoginOutlined,
  MinusCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RocketOutlined,
  SearchOutlined,
  SettingOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Skeleton,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { EmptyState, EnvironmentStatusCard, PlatformChip } from '../components/common';
import type { PlatformChipVariant } from '../components/common';
import { useAiTask, useAiConfig } from '../hooks/useAiTask';
import { useCdpStatus } from '../hooks/useCdpStatus';
import { useSSEHandler } from '../hooks/useSSE';
import type { SSEEventData } from '../hooks/useSSE';
import { useDataStore } from '../stores/dataStore';
import type { CityCodes, ScriptProgress, TaskHistoryEntry } from '../types';
import './scan.css';

type LoadState = 'loading' | 'ready' | 'error';
type Platform = '猎聘' | '51job';
type HistoryPlatform = Platform | 'BOSS' | '智联' | '其他';
type ScanFormValues = { platform: Platform; query: string; cities: string[]; rounds: number };
type RunningTask = {
  id: string;
  platform: Platform;
  query: string;
  city: string;
  startedAt: string;
  progress: ScriptProgress;
};
type HistoryRow = TaskHistoryEntry & {
  key: string;
  platform: HistoryPlatform;
  query: string;
  city: string;
  current?: number;
  total?: number;
};
type TaskHistoryApiRow = Partial<TaskHistoryEntry> & {
  task_id?: string;
  exit_code?: number | null;
  dedup_rate?: number | null;
};

const PLATFORM_OPTIONS: Array<{ value: Platform; label: string; variant: PlatformChipVariant; script: string; roundArg: string }> = [
  { value: '猎聘', label: '猎聘', variant: 'liepin', script: 'liepin-dom', roundArg: '--max-pages' },
  { value: '51job', label: '前程无忧（51job）', variant: '51job', script: '51job-opencli', roundArg: '--max-pages' },
];

const PLATFORM_CITY_KEYS: Record<Platform, keyof CityCodes> = { 猎聘: 'liepin', '51job': '51job' };
const PLATFORM_LOGIN_KEYS: Record<Platform, string> = { 猎聘: 'liepin', '51job': '51job' };
const ALL_LOGIN_PLATFORMS = ['liepin', '51job'];
const PREFERRED_CITY: Record<Platform, string> = { 猎聘: '020', '51job': '030200' };

const numberFormat = new Intl.NumberFormat('zh-CN');
const { RangePicker } = DatePicker;

function platformMeta(platform: HistoryPlatform) {
  return PLATFORM_OPTIONS.find((item) => item.value === platform) ?? { label: platform, variant: 'boss' as const, script: '', roundArg: '' };
}

function formatDuration(started?: string | null, ended?: string | null) {
  if (!started) return '—';
  const seconds = Math.max(0, dayjs(ended ?? undefined).diff(dayjs(started), 'second'));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function estimateRemaining(task: RunningTask) {
  const elapsedSeconds = Math.max(1, dayjs().diff(dayjs(task.startedAt), 'second'));
  const rate = task.progress.current / elapsedSeconds;
  if (!rate || task.progress.total <= task.progress.current) return '00:00:00';
  const remaining = Math.ceil((task.progress.total - task.progress.current) / rate);
  return formatDuration(dayjs().subtract(remaining, 'second').toISOString(), undefined);
}

function parseArgs(args: string) {
  const normalized = args.replace(/"(--\w[\w-]*)"/g, '$1');
  const read = (flag: string) => normalized.match(new RegExp(`${flag}\\s+(?:"([^"]+)"|'([^']+)'|(\\S+))`))?.slice(1).find(Boolean);
  return {
    query: read('--query') ?? '未记录关键词',
    city: read('--city') ?? '—',
    current: Number(read('--current')) || undefined,
    total: Number(read('--total') ?? read('--max-scroll-rounds') ?? read('--max-pages')) || undefined,
  };
}

function inferPlatform(script: string): HistoryPlatform {
  const value = script.toLowerCase();
  if (value.includes('boss')) return 'BOSS';
  if (value.includes('zhaopin')) return '智联';
  if (value.includes('liepin')) return '猎聘';
  if (value.includes('51job')) return '51job';
  return '其他';
}

function normalizeTaskHistory(item: TaskHistoryApiRow): TaskHistoryEntry {
  const found = item.found === undefined || item.found === null ? undefined : Number(item.found);
  const dedupRateValue = item.dedupRate ?? item.dedup_rate;
  const dedupRate = dedupRateValue === undefined || dedupRateValue === null
    ? undefined
    : Number(dedupRateValue);

  return {
    taskId: item.taskId ?? item.task_id ?? '',
    script: item.script ?? '',
    args: item.args ?? '',
    started: item.started ?? '',
    ended: item.ended,
    exitCode: item.exitCode ?? item.exit_code,
    found: Number.isFinite(found) ? found : undefined,
    dedupRate: Number.isFinite(dedupRate) ? dedupRate : undefined,
  };
}

function RunningTaskCard({ task }: { task: RunningTask }) {
  const meta = platformMeta(task.platform);
  const percent = task.progress.total ? Math.min(100, Math.round((task.progress.current / task.progress.total) * 100)) : 0;
  return (
    <div className="scan-runner">
      <div className="scan-runner__head"><PlatformChip variant={meta.variant} /><strong>{meta.label} - {task.query}</strong><Tag color="processing">运行中</Tag></div>
      <div className="scan-runner__meta"><span>{task.progress.step}：{task.progress.current} / {task.progress.total}（{percent}%）</span><span>新发现 {task.progress.found ?? 0}</span></div>
      <Progress percent={percent} showInfo={false} strokeColor="var(--co-primary)" />
      <div className="scan-runner__meta"><span>预计剩余 {estimateRemaining(task)}</span></div>
    </div>
  );
}

export function Scan() {
  const [notice, noticeContext] = message.useMessage();
  const navigate = useNavigate();
  const [form] = Form.useForm<ScanFormValues>();
  const platform = Form.useWatch('platform', form) ?? '猎聘';
  const selectedCities = Form.useWatch('cities', form) ?? [];
  const selectedRounds = Form.useWatch('rounds', form);
  const { scanHistory, taskHistory: storeTaskHistory, loading: dataLoading, error: dataError } = useDataStore();
  const reloadTaskHistory = useDataStore((s) => s.reloadTaskHistory);
  const reloadScanHistory = useDataStore((s) => s.reloadScanHistory);
  const reloadPipeline = useDataStore((s) => s.reloadPipeline);
  const loadState: LoadState = dataLoading ? 'loading' : dataError ? 'error' : 'ready';
  const todayScans = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    return scanHistory.filter((row) => row.firstSeen?.startsWith(today));
  }, [scanHistory]);
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [cityCodes, setCityCodes] = useState<CityCodes>();
  const [query, setQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<Platform>();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [runningTasks, setRunningTasks] = useState<RunningTask[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [portalsEditorOpen, setPortalsEditorOpen] = useState(false);
  const [portalsDraft, setPortalsDraft] = useState('');
  const [portalsData, setPortalsData] = useState<Record<string, unknown> | null>(null);
  const [savingPortals, setSavingPortals] = useState(false);
  const [portalsActiveTab, setPortalsActiveTab] = useState('overview');
  const aiConfigTask = useAiTask();
  const { config: aiConfig } = useAiConfig();

  const syncPortalsToYaml = useCallback(async (data: Record<string, unknown>) => {
    try {
      const YAML = await import('yaml');
      setPortalsDraft(YAML.stringify(data));
    } catch { /* ignore */ }
  }, []);

  const updatePortalsField = useCallback((path: string[], value: unknown) => {
    setPortalsData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      let obj: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) {
        if (!obj[path[i]] || typeof obj[path[i]] !== 'object') obj[path[i]] = {};
        obj = obj[path[i]] as Record<string, unknown>;
      }
      obj[path[path.length - 1]] = value;
      void syncPortalsToYaml(next);
      return next;
    });
  }, [syncPortalsToYaml]);
  const cdp = useCdpStatus(ALL_LOGIN_PLATFORMS);
  const aiTask = useAiTask();
  const chromeReady = cdp.chrome === 'ready';
  const currentLoginKey = PLATFORM_LOGIN_KEYS[platform];
  const currentLoginState = cdp.platforms[currentLoginKey];

  useEffect(() => {
    if (aiTask.status.state === 'completed') void notice.success('AI 自动采集完成');
    if (aiTask.status.state === 'failed') void notice.error(aiTask.status.error ?? 'AI 自动采集失败');
  }, [aiTask.status.state, aiTask.status.error, notice]);

  const startAiScan = async () => {
    const result = await aiTask.start('scan', 'portals.yml');
    if ('error' in result) void notice.error(result.error);
    else void notice.info('AI 自动采集已启动，将依据 portals.yml 配置执行全平台采集');
  };

  useEffect(() => {
    setHistory(storeTaskHistory.map(normalizeTaskHistory));
  }, [storeTaskHistory]);

  useEffect(() => {
    let active = true;
    fetch('/api/config/cities')
      .then((response) => response.ok ? response.json() as Promise<CityCodes> : Promise.reject())
      .then((data) => { if (active) setCityCodes(data); })
      .catch(() => { /* city codes unavailable */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const cities = cityCodes?.[PLATFORM_CITY_KEYS[platform]] ?? [];
    const preferred = PREFERRED_CITY[platform];
    const defaultCity = cities.some((city) => city.code === preferred) ? preferred : cities[0]?.code;
    form.setFieldValue('cities', defaultCity ? [defaultCity] : []);
    form.setFieldValue('rounds', 10);
  }, [cityCodes, form, platform]);

  const onScriptProgress = useCallback((data: SSEEventData) => {
    if (!data.jobId || !data.progress) return;
    setRunningTasks((current) => current.map((item) =>
      item.id === data.jobId ? { ...item, progress: data.progress as ScriptProgress } : item,
    ));
  }, []);

  const onScriptDone = useCallback((data: SSEEventData) => {
    if (!data.jobId) return;
    const completed = data.exitCode === 0 || !('error' in data);
    setRunningTasks((current) => current.filter((item) => item.id !== data.jobId));
    setHistory((current) => current.map((item) =>
      item.taskId === data.jobId
        ? { ...item, ended: new Date().toISOString(), exitCode: completed ? 0 : 1 }
        : item,
    ));
    // 数据由服务端/Agent 写入工作目录，这里只重新拉取展示。
    void reloadScanHistory();
    void reloadPipeline();
    void reloadTaskHistory();
  }, [reloadScanHistory, reloadPipeline, reloadTaskHistory]);

  useSSEHandler('script-progress', onScriptProgress);
  useSSEHandler('script-completed', onScriptDone);
  useSSEHandler('script-failed', onScriptDone);

  const openPortalsEditor = async () => {
    try {
      const res = await fetch('/api/data/portals');
      const data = res.ok ? await res.json() as Record<string, unknown> : null;
      const YAML = await import('yaml');
      setPortalsData(data && typeof data === 'object' ? data : null);
      setPortalsDraft(data ? YAML.stringify(data) : '');
      setPortalsEditorOpen(true);
    } catch {
      setPortalsData(null);
      setPortalsDraft('');
      setPortalsEditorOpen(true);
      void notice.warning('portals.yml 不存在或为空');
    }
  };

  useEffect(() => {
    if (aiConfigTask.status.state === 'completed') {
      void notice.success('AI 已生成采集配置建议，请刷新查看 portals.yml');
      void openPortalsEditor();
    }
    if (aiConfigTask.status.state === 'failed') void notice.error(aiConfigTask.status.error ?? 'AI 配置生成失败');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConfigTask.status.state]);

  const generateAiConfig = async () => {
    const result = await aiConfigTask.start('scan', 'generate-portals-config', { action: 'generate-config' });
    if ('error' in result) void notice.error(result.error);
    else void notice.info('AI 正在根据你的 CV 和 profile 生成采集配置...');
  };

  // 只读看板：采集配置改为交给 Agent 落盘。这里校验 YAML 并提示如何交给 Agent。
  const savePortals = async () => {
    try {
      const YAML = await import('yaml');
      YAML.parse(portalsDraft);
    } catch {
      void notice.error('YAML 格式有误，请先修正');
      return;
    }
    void notice.info('采集配置修改请对 Agent 说：把编辑后的 YAML 更新到 portals.yml');
    setPortalsEditorOpen(false);
  };

  const stopTask = async (jobId: string) => {
    const response = await fetch(`/api/scripts/${jobId}`, { method: 'DELETE' });
    if (response.ok) void notice.success('已发送终止请求');
    else void notice.error('终止任务失败');
  };

  const submitTasks = async (values: ScanFormValues) => {
    setSubmitting(true);
    const meta = platformMeta(values.platform);
    try {
      for (const city of values.cities) {
        const resolvedCity = platformCities.find((item) => item.code === city || item.name === city)?.code ?? city;
        const args = ['--query', values.query, '--city', resolvedCity, meta.roundArg, String(values.rounds)];
        const response = await fetch(`/api/scripts/${meta.script}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ args }),
        });
        if (!response.ok) throw new Error(response.status === 409 ? `${meta.label} 已有任务在运行，同一脚本不能并行` : `启动失败：${response.status}`);
        const job = await response.json() as { jobId: string };
        const task: RunningTask = {
          id: job.jobId,
          platform: values.platform,
          query: values.query,
          city: resolvedCity,
          startedAt: new Date().toISOString(),
          progress: { step: '正在启动', current: 0, total: values.rounds, found: 0 },
        };
        setRunningTasks((current) => [...current, task]);
        setHistory((current) => [{ taskId: job.jobId, script: meta.script, args: args.map((arg) => JSON.stringify(arg)).join(' '), started: task.startedAt }, ...current]);
      }
      void notice.success('采集任务已启动');
    } catch (error) {
      void notice.error(error instanceof Error ? error.message : '采集任务启动失败');
    } finally {
      setSubmitting(false);
    }
  };

  const stats = useMemo(() => {
    const added = todayScans.filter((row) => row.status === 'added').length;
    const skipped = todayScans.filter((row) => row.status.startsWith('skipped_')).length;
    return { total: todayScans.length, added, skipped, rate: todayScans.length ? (skipped / todayScans.length) * 100 : 0 };
  }, [todayScans]);

  const historyRows = useMemo<HistoryRow[]>(() => history
    .filter((item) => inferPlatform(item.script) !== '其他')
    .map((item) => {
      const parsed = parseArgs(item.args);
      return { ...item, ...parsed, key: item.taskId, platform: inferPlatform(item.script) };
    })
    .sort((a, b) => (b.started > a.started ? 1 : b.started < a.started ? -1 : 0)),
    [history]);

  const filteredHistory = useMemo(() => historyRows.filter((row) => {
    const keyword = query.trim().toLocaleLowerCase();
    const status = row.ended ? row.exitCode === 0 ? 'completed' : 'failed' : 'running';
    if (keyword && !`${row.script} ${row.args} ${row.query} ${row.platform}`.toLocaleLowerCase().includes(keyword)) return false;
    if (platformFilter && row.platform !== platformFilter) return false;
    if (statusFilter && status !== statusFilter) return false;
    if (dateRange?.[0] && dayjs(row.started).isBefore(dateRange[0].startOf('day'))) return false;
    if (dateRange?.[1] && dayjs(row.started).isAfter(dateRange[1].endOf('day'))) return false;
    return true;
  }), [dateRange, historyRows, platformFilter, query, statusFilter]);

  const columns: ColumnsType<HistoryRow> = [
    { title: '任务名称', render: (_, row) => <strong>{platformMeta(row.platform).label} - {row.query}</strong>, width: 210 },
    { title: '平台', dataIndex: 'platform', width: 66, render: (value: HistoryRow['platform']) => value === '其他' ? '其他' : <PlatformChip variant={platformMeta(value).variant} title={value} /> },
    { title: '城市', dataIndex: 'city', width: 90, render: (code: string, row: HistoryRow) => {
      if (!cityCodes || code === '—') return code;
      const key = PLATFORM_CITY_KEYS[row.platform as Platform];
      const list = key ? cityCodes[key] : undefined;
      return list?.find((c) => String(c.code) === code)?.name ?? code;
    } },
    { title: '状态', width: 90, render: (_, row) => row.ended ? row.exitCode === 0 ? <Tag color="success">已完成</Tag> : <Tag color="error">运行失败</Tag> : <Tag color="processing">运行中</Tag> },
    { title: '进度', width: 140, render: (_, row) => row.total ? <div className="scan-history-progress"><span>{row.current ?? row.total} / {row.total}</span><Progress percent={Math.round(((row.current ?? row.total) / row.total) * 100)} showInfo={false} /></div> : '—' },
    { title: '新发现', dataIndex: 'found', width: 80, render: (value?: number | null) => value ?? '—' },
    { title: '去重率', dataIndex: 'dedupRate', width: 80, render: (value?: number | null) => value === null || value === undefined ? '—' : `${value.toFixed(1)}%` },
    { title: '开始时间', dataIndex: 'started', width: 130, render: (value: string) => dayjs(value).format('MM-DD HH:mm') },
    { title: '时长', width: 90, render: (_, row) => formatDuration(row.started, row.ended) },
  ];

  if (loadState === 'loading') {
    return <main className="app-page scan-page">{noticeContext}<Skeleton active /><div className="scan-layout"><div className="scan-stack">{Array.from({ length: 2 }, (_, index) => <Card key={index}><Skeleton active /></Card>)}</div><div className="scan-stack">{Array.from({ length: 3 }, (_, index) => <Card key={index}><Skeleton active /></Card>)}</div></div></main>;
  }

  const selectedPlatform = platformMeta(platform);
  const platformCities = cityCodes?.[PLATFORM_CITY_KEYS[platform]] ?? [];
  const cityOptions = platformCities.map(({ name, code }) => ({ label: `${name}（${code}）`, value: code }));
  const resolvedCityCodes = selectedCities.map((value) => platformCities.find((city) => city.code === value || city.name === value)?.code ?? value);
  const cliPreview = resolvedCityCodes.map((city) => `--query "关键词" --city ${city} ${selectedPlatform.roundArg} ${selectedRounds}`).join('\n');

  return (
    <main className="app-page scan-page">
      {noticeContext}
      <div className="scan-head"><h1>采集任务</h1><p>自动化采集职位信息，构建高质量 Pipeline 队列</p></div>
      {loadState === 'error' ? <Alert type="error" showIcon message="采集任务数据加载失败" description="请确认 Web API 服务已启动后刷新页面。当前以空态显示。" /> : null}
      <div className="scan-layout">
        <div className="scan-stack">
          <div className="scan-overview">
            <Card className="scan-card scan-running-card" title="运行中任务" extra={<span className="scan-count">{runningTasks.length}</span>}>
              {runningTasks.length ? <div className="scan-runner-grid">{runningTasks.slice(0, 2).map((task) => <RunningTaskCard key={task.id} task={task} />)}</div> : <EmptyState title="暂无运行中任务" description="由 AI Agent 启动的任务会显示在这里。" />}
            </Card>
            <EnvironmentStatusCard className="scan-card" />
            <Card className="scan-card" title="去重统计（今日）">
              <div className="scan-kv">
                <div><span>总扫描</span><strong>{numberFormat.format(stats.total)}</strong></div>
                <div><span>新增候选</span><strong className="is-primary">{numberFormat.format(stats.added)}</strong></div>
                <div><span>去重过滤</span><strong>{numberFormat.format(stats.skipped)}</strong></div>
                <div><span>去重率</span><strong className="is-success">{stats.rate.toFixed(1)}%</strong></div>
              </div>
            </Card>
          </div>

          <Card className="scan-card scan-history-card" title="任务历史">
            <div className="scan-toolbar">
              <Input allowClear prefix={<SearchOutlined />} placeholder="搜索任务名称 / 关键词 / 平台" value={query} onChange={(event) => setQuery(event.target.value)} />
              <Select allowClear placeholder="所有平台" value={platformFilter} onChange={setPlatformFilter} options={PLATFORM_OPTIONS.map(({ value, label }) => ({ value, label }))} />
              <Select allowClear placeholder="所有状态" value={statusFilter} onChange={setStatusFilter} options={[{ value: 'running', label: '运行中' }, { value: 'completed', label: '已完成' }, { value: 'failed', label: '运行失败' }]} />
              <RangePicker value={dateRange} onChange={setDateRange} />
            </div>
            {filteredHistory.length ? <Table rowKey="key" columns={columns} dataSource={filteredHistory} scroll={{ x: 1200 }} pagination={{ pageSize: 10, showSizeChanger: true }} /> : <EmptyState icon={<HistoryOutlined />} title="暂无任务历史" description="任务历史从首次通过 Web 启动任务起累积" />}
          </Card>
        </div>

        <div className="scan-stack">
          <Card className="scan-card" title="采集说明">
            <div className="scan-notes">
              <p>采集、去重和初筛请通过 AI Agent 使用自然语言执行。</p>
              <p>完成后，采集历史和待处理职位会自动显示在本页及待处理队列。</p>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        title="采集配置（portals.yml）"
        open={portalsEditorOpen}
        width={1060}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingPortals}
        onCancel={() => setPortalsEditorOpen(false)}
        onOk={() => void savePortals()}
      >
        <Tabs activeKey={portalsActiveTab} onChange={(key) => {
          if (key === 'yaml' && portalsData) { void syncPortalsToYaml(portalsData); }
          if (key === 'overview' && portalsActiveTab === 'yaml') {
            try {
              import('yaml').then((YAML) => { setPortalsData(YAML.parse(portalsDraft) as Record<string, unknown>); }).catch(() => {});
            } catch { /* ignore */ }
          }
          setPortalsActiveTab(key);
        }} items={[
          { key: 'overview', label: '可视化编辑', children: portalsData ? (() => {
            const titleFilter = (portalsData.title_filter ?? {}) as { positive?: string[]; negative?: string[] };
            const trackedCompanies = (portalsData.tracked_companies ?? []) as Array<Record<string, unknown>>;
            const SEARCH_PLATFORMS = [
              { key: 'liepin_searches', label: '猎聘', defaultCity: '020', cityHint: '上海020 深圳050090 北京010 广州050020' },
              { key: '51job_searches', label: '前程无忧', defaultCity: '020000', cityHint: '上海020000 深圳040000 北京010000 广州030200' },
            ] as const;
            const renderSearchTable = (platformKey: string, defaultCity: string, cityHint: string) => {
              const searches = (portalsData[platformKey] ?? []) as Array<Record<string, unknown>>;
              return (
                <>
                  <div style={{ marginBottom: 8, color: 'var(--co-text-3)', fontSize: 12 }}>城市代码参考: {cityHint}</div>
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(_, i) => String(i)}
                    dataSource={searches}
                    scroll={{ y: 220 }}
                    columns={[
                      { title: '名称', dataIndex: 'name', width: 180, render: (v: string, _: unknown, i: number) => (
                        <Input size="small" value={v} onChange={(e) => { const arr = [...searches]; arr[i] = { ...arr[i], name: e.target.value }; updatePortalsField([platformKey], arr); }} />
                      ) },
                      { title: '关键词', dataIndex: 'query', width: 160, render: (v: string, _: unknown, i: number) => (
                        <Input size="small" value={v} onChange={(e) => { const arr = [...searches]; arr[i] = { ...arr[i], query: e.target.value }; updatePortalsField([platformKey], arr); }} />
                      ) },
                      { title: '城市代码', dataIndex: 'city_code', width: 120, render: (v: string, _: unknown, i: number) => (
                        <Input size="small" value={v} onChange={(e) => { const arr = [...searches]; arr[i] = { ...arr[i], city_code: e.target.value }; updatePortalsField([platformKey], arr); }} />
                      ) },
                      { title: '启用', dataIndex: 'enabled', width: 70, render: (v: boolean, _: unknown, i: number) => (
                        <Switch size="small" checked={v} onChange={(checked) => { const arr = [...searches]; arr[i] = { ...arr[i], enabled: checked }; updatePortalsField([platformKey], arr); }} />
                      ) },
                      { title: '', width: 40, render: (_: unknown, __: unknown, i: number) => (
                        <Popconfirm title="确定删除?" onConfirm={() => { const arr = searches.filter((_, idx) => idx !== i); updatePortalsField([platformKey], arr); }}>
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      ) },
                    ]}
                    footer={() => (
                      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => {
                        updatePortalsField([platformKey], [...searches, { name: '', query: '', city_code: defaultCity, enabled: true }]);
                      }}>添加搜索条件</Button>
                    )}
                  />
                </>
              );
            };
            return (
              <div className="scan-portals-overview" style={{ maxHeight: 560, overflowY: 'auto', padding: '0 4px' }}>
                <Divider orientation="left" style={{ margin: '4px 0 12px' }}>标题过滤词</Divider>
                <Form.Item label="正向关键词（匹配这些词的职位才通过）" style={{ marginBottom: 8 }}>
                  <Select mode="tags" value={titleFilter.positive ?? []} onChange={(v) => updatePortalsField(['title_filter', 'positive'], v)} placeholder="输入后回车添加" tokenSeparators={[',']} />
                </Form.Item>
                <Form.Item label="排除关键词（包含这些词的职位被过滤）" style={{ marginBottom: 8 }}>
                  <Select mode="tags" value={titleFilter.negative ?? []} onChange={(v) => updatePortalsField(['title_filter', 'negative'], v)} placeholder="输入后回车添加" tokenSeparators={[',']} />
                </Form.Item>

                <Divider orientation="left" style={{ margin: '8px 0 12px' }}>平台搜索条件</Divider>
                <Tabs
                  size="small"
                  type="card"
                  items={SEARCH_PLATFORMS.map((p) => {
                    const searches = (portalsData[p.key] ?? []) as Array<Record<string, unknown>>;
                    const enabledCount = searches.filter((s) => s.enabled).length;
                    return {
                      key: p.key,
                      label: <span>{p.label} <Tag style={{ marginLeft: 4 }}>{enabledCount}/{searches.length}</Tag></span>,
                      children: renderSearchTable(p.key, p.defaultCity, p.cityHint),
                    };
                  })}
                />

                <Divider orientation="left" style={{ margin: '12px 0 12px' }}>跟踪公司</Divider>
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(_, i) => String(i)}
                  dataSource={trackedCompanies}
                  scroll={{ y: 160 }}
                  columns={[
                    { title: '公司', dataIndex: 'name', width: 120, render: (v: string, _: unknown, i: number) => (
                      <Input size="small" value={v} onChange={(e) => { const arr = [...trackedCompanies]; arr[i] = { ...arr[i], name: e.target.value }; updatePortalsField(['tracked_companies'], arr); }} />
                    ) },
                    { title: '招聘页', dataIndex: 'careers_url', width: 240, render: (v: string, _: unknown, i: number) => (
                      <Input size="small" value={v} onChange={(e) => { const arr = [...trackedCompanies]; arr[i] = { ...arr[i], careers_url: e.target.value }; updatePortalsField(['tracked_companies'], arr); }} />
                    ) },
                    { title: '搜索 query', dataIndex: 'scan_query', render: (v: string, _: unknown, i: number) => (
                      <Input size="small" value={v} onChange={(e) => { const arr = [...trackedCompanies]; arr[i] = { ...arr[i], scan_query: e.target.value }; updatePortalsField(['tracked_companies'], arr); }} />
                    ) },
                    { title: '启用', dataIndex: 'enabled', width: 70, render: (v: boolean, _: unknown, i: number) => (
                      <Switch size="small" checked={v} onChange={(checked) => { const arr = [...trackedCompanies]; arr[i] = { ...arr[i], enabled: checked }; updatePortalsField(['tracked_companies'], arr); }} />
                    ) },
                    { title: '', width: 40, render: (_: unknown, __: unknown, i: number) => (
                      <Popconfirm title="确定删除?" onConfirm={() => { const arr = trackedCompanies.filter((_, idx) => idx !== i); updatePortalsField(['tracked_companies'], arr); }}>
                        <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    ) },
                  ]}
                  footer={() => (
                    <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => {
                      updatePortalsField(['tracked_companies'], [...trackedCompanies, { name: '', careers_url: '', scan_method: 'websearch', scan_query: '', enabled: true }]);
                    }}>添加跟踪公司</Button>
                  )}
                />

                <Alert
                  style={{ marginTop: 12 }}
                  type="info"
                  showIcon
                  icon={<BulbOutlined />}
                  message="AI 智能推荐"
                  description="AI 可以根据你的 CV 和 profile.yml 自动生成/优化采集配置，包括搜索关键词、城市和标题过滤器。"
                  action={<Button size="small" type="primary" icon={<BulbOutlined />} loading={aiConfigTask.status.state === 'running'} onClick={() => void generateAiConfig()}>AI 生成配置</Button>}
                />
              </div>
            );
          })() : <EmptyState icon={<SettingOutlined style={{ fontSize: 40 }} />} title="暂无采集配置" description="portals.yml 为空或未创建。切换到「YAML 编辑」手动编写，或使用 AI 生成配置。" /> },
          { key: 'yaml', label: 'YAML 编辑', children: (
            <>
              <Alert type="warning" showIcon message="直接编辑 YAML 源文件，修改后点击保存。格式错误会导致保存失败。" />
              <Input.TextArea style={{ marginTop: 12, fontFamily: 'monospace', fontSize: 13 }} value={portalsDraft} onChange={(event) => setPortalsDraft(event.target.value)} autoSize={{ minRows: 20, maxRows: 30 }} />
            </>
          ) },
        ]} />
      </Modal>
    </main>
  );
}
