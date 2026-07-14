import {
  AuditOutlined,
  CalendarOutlined,
  CheckCircleFilled,
  CheckSquareOutlined,
  CloudDownloadOutlined,
  FilePdfOutlined,
  FundProjectionScreenOutlined,
  PlusCircleOutlined,
  ReloadOutlined,
  SendOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Progress, Skeleton, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { EmptyState, EnvironmentStatusCard, PlatformChip, StatCard, StatStrip } from '../components/common';
import type { PlatformChipVariant } from '../components/common';
import { useDoctorStatus } from '../hooks/useDoctorStatus';
import { useDataStore } from '../stores/dataStore';
import './dashboard.css';

type DailyScan = {
  date: string;
  portal: string;
  added: number;
  skipped: number;
};

type MetricsHistory = { date: string; scanned: number; pending: number; processed: number; applied: number; interview: number; offers: number };
type ActivityEntry = { ts: string; type: string; summary: string };

const formatNumber = (value: number | undefined) => new Intl.NumberFormat('zh-CN').format(value ?? 0);

function platformVariant(portal: string): PlatformChipVariant {
  const value = portal.toLowerCase();
  if (value.includes('boss')) return 'boss';
  if (value.includes('猎聘') || value.includes('liepin')) return 'liepin';
  if (value.includes('智联') || value.includes('zhaopin')) return 'zhaopin';
  if (value.includes('前程') || value.includes('51job')) return '51job';
  return 'boss';
}

function statusTone(status: string) {
  if (status === 'ok') return { dot: 'ok', label: '正常', color: 'success' };
  if (status === 'warn') return { dot: 'warn', label: '警告', color: 'warning' };
  if (status === 'fail') return { dot: 'fail', label: '异常', color: 'error' };
  return { dot: 'unknown', label: '未检测', color: 'default' };
}

export function Dashboard() {
  const navigate = useNavigate();
  const doctor = useDoctorStatus();
  const {
    loading: dataLoading,
    applications,
    pipeline: pipelineData,
    scanHistory,
    metricsHistory,
    activityLog,
  } = useDataStore();

  const scans = useMemo(() => {
    const map = new Map<string, DailyScan>();
    for (const entry of scanHistory) {
      const date = entry.firstSeen?.split('T')[0] ?? entry.firstSeen;
      const key = `${date}|${entry.portal}`;
      const existing = map.get(key) ?? { date, portal: entry.portal, added: 0, skipped: 0 };
      if (entry.status === 'added') existing.added++;
      else existing.skipped++;
      map.set(key, existing);
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [scanHistory]);

  const byStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const app of applications) counts[app.status] = (counts[app.status] ?? 0) + 1;
    return counts;
  }, [applications]);

  const pending = pipelineData.pending.length;
  const processed = pipelineData.processed.length;
  const pipelineTotal = pending + processed;
  const applied = (byStatus.Applied ?? 0) + (byStatus.Responded ?? 0) + (byStatus.Interview ?? 0);
  const interviewed = byStatus.Interview ?? 0;

  const todayStr = dayjs().format('YYYY-MM-DD');
  const yesterdayStr = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const todayAdded = scans.filter((s) => s.date === todayStr).reduce((sum, s) => sum + s.added, 0);
  const yesterdayAdded = scans.filter((s) => s.date === yesterdayStr).reduce((sum, s) => sum + s.added, 0);
  const delta = todayAdded - yesterdayAdded;
  const now = dayjs();
  const recentScans = scans.slice(0, 5);
  const lastSevenDays = scans.filter((scan) => dayjs(scan.date).isAfter(now.subtract(7, 'day').startOf('day')));
  const scanTotal = scans.reduce((sum, scan) => sum + scan.added + scan.skipped, 0);
  const lastSevenAdded = lastSevenDays.reduce((sum, scan) => sum + scan.added, 0);
  const lastSevenSkipped = lastSevenDays.reduce((sum, scan) => sum + scan.skipped, 0);
  const yesterday = metricsHistory.find((item) => item.date === yesterdayStr);
  const activities = [...activityLog].reverse().slice(0, 8);
  const deltaText = (value: number, previous: number | undefined) => previous === undefined ? '暂无昨日快照' : `较昨日 ${value - previous >= 0 ? '+' : ''}${value - previous}`;
  const deltaDirection = (value: number, previous: number | undefined) => previous === undefined || value === previous ? 'neutral' as const : value > previous ? 'up' as const : 'down' as const;

  const scanColumns: ColumnsType<DailyScan> = [
    {
      title: '平台',
      dataIndex: 'portal',
      render: (portal: string) => (
        <span className="dashboard-platform">
          <PlatformChip variant={platformVariant(portal)} label={platformVariant(portal) === 'boss' && !portal.toLowerCase().includes('boss') ? '其' : undefined} />
          {portal}
        </span>
      ),
    },
    { title: '关键词', render: () => '每日汇总' },
    { title: '城市', render: () => '—' },
    { title: '采集时间', dataIndex: 'date' },
    { title: '采集条数', render: (_, row) => <strong>{row.added + row.skipped}</strong> },
    { title: '去重后', dataIndex: 'added', render: (value: number) => <strong>{value}</strong> },
    { title: '初筛通过', render: () => '—' },
    { title: '状态', render: () => <Tag color="success">成功</Tag> },
  ];

  const environmentGroups = useMemo(() => [
    { name: '基础环境', icon: '基', patterns: ['node.js', '依赖目录'] },
    { name: '求职配置', icon: '配', patterns: ['cv.md', 'profile.yml', 'portals.yml'] },
    { name: '数据目录', icon: '数', patterns: ['数据目录'] },
    { name: '采集环境', icon: '采', patterns: ['chrome', 'opencli'] },
  ], []);

  if (dataLoading) {
    return (
      <main className="app-page dashboard-page">
        <Skeleton active paragraph={{ rows: 1 }} />
        <div className="dashboard-stat-grid">
          {Array.from({ length: 5 }, (_, index) => <Card key={index}><Skeleton active paragraph={{ rows: 1 }} /></Card>)}
        </div>
        <div className="dashboard-layout">
          <div className="dashboard-stack">{Array.from({ length: 3 }, (_, index) => <Card key={index}><Skeleton active /></Card>)}</div>
          <div className="dashboard-stack">{Array.from({ length: 3 }, (_, index) => <Card key={index}><Skeleton active /></Card>)}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="app-page dashboard-page">
      <div className="dashboard-welcome">
        <h1>{now.hour() < 12 ? '上午好' : now.hour() < 18 ? '下午好' : '晚上好'}！</h1>
        <p>今天是 {now.format('YYYY-MM-DD')}，继续推进你的求职自动化流程吧！</p>
      </div>

      {useDataStore.getState().error ? (
        <Alert
          className="dashboard-alert"
          type="error"
          showIcon
          message="数据加载失败"
          description={useDataStore.getState().error}
        />
      ) : null}

      <div className="dashboard-layout">
        <div className="dashboard-stack">
          <div className="dashboard-stat-grid">
            <StatCard label="今日采集" value={formatNumber(todayAdded)} tone="primary" icon={<CloudDownloadOutlined />} delta={`较昨日 ${delta >= 0 ? '+' : ''}${delta}`} deltaDirection={delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'} />
            <StatCard label="待处理" value={formatNumber(pending)} tone="success" icon={<CheckSquareOutlined />} delta={deltaText(pending, yesterday?.pending)} deltaDirection={deltaDirection(pending, yesterday?.pending)} />
            <StatCard label="已处理" value={formatNumber(processed)} tone="info" icon={<AuditOutlined />} delta={deltaText(processed, yesterday?.processed)} deltaDirection={deltaDirection(processed, yesterday?.processed)} />
            <StatCard label="投递中" value={formatNumber(applied)} tone="purple" icon={<SendOutlined />} delta={deltaText(applied, yesterday?.applied)} deltaDirection={deltaDirection(applied, yesterday?.applied)} />
            <StatCard label="面试中职位" value={formatNumber(interviewed)} tone="danger" icon={<CalendarOutlined />} delta={deltaText(interviewed, yesterday?.interview)} deltaDirection={deltaDirection(interviewed, yesterday?.interview)} />
          </div>

          <div className="dashboard-grid dashboard-grid--tasks">
            <Card className="dashboard-card" title="运行中任务" extra={<span className="dashboard-count">0</span>}>
              <EmptyState title="暂无运行中任务" description="任务订阅将在 G3 接入" />
            </Card>
            <Card className="dashboard-card" title="环境就绪状态" extra={<span className="dashboard-muted"><ReloadOutlined /> {doctor.detected ? '刚刚检查' : '未检测'}</span>}>
              <div className="dashboard-env-grid">
                {environmentGroups.map((group) => {
                  const checks = doctor.checks.filter((check) => group.patterns.some((pattern) => check.label.toLowerCase().includes(pattern)));
                  return (
                    <div className="dashboard-env-card" key={group.name}>
                      <div className="dashboard-env-card__name"><span className="dashboard-env-icon">{group.icon}</span>{group.name}</div>
                      {checks.length ? checks.map((check) => {
                        const tone = statusTone(check.status);
                        return <div className="dashboard-env-row" key={check.id}><span title={check.detail}>{check.label}</span><CheckCircleFilled className={`dashboard-check dashboard-check--${tone.dot}`} /></div>;
                      }) : <div className="dashboard-env-row"><span>状态</span><Tag>未检测</Tag></div>}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="dashboard-grid dashboard-grid--pipeline">
            <Card className="dashboard-card dashboard-table-card" title="最近采集任务" extra={<Link to="/collection">查看全部采集任务 →</Link>}>
              {recentScans.length ? (
                <Table rowKey={(row) => `${row.date}-${row.portal}`} columns={scanColumns} dataSource={recentScans} pagination={false} size="small" scroll={{ x: 780 }} />
              ) : <EmptyState title="暂无采集记录" />}
            </Card>
            <Card className="dashboard-card" title="队列概览">
              <div className="dashboard-kv">
                <div><span>待处理</span><strong className="dashboard-primary">{formatNumber(pending)}</strong></div>
                <div><span>已处理</span><strong>{formatNumber(processed)}</strong></div>
                <div><span>总计</span><strong>{formatNumber(pipelineTotal)}</strong></div>
                <div><span>最近处理</span><strong>—</strong></div>
              </div>
              <div className="dashboard-progress-label"><span>处理进度</span><span>{pipelineTotal ? ((processed / pipelineTotal) * 100).toFixed(1) : '0.0'}%</span></div>
              <Progress percent={pipelineTotal ? Number(((processed / pipelineTotal) * 100).toFixed(1)) : 0} showInfo={false} strokeColor="var(--co-success-fg)" />
              <Button block onClick={() => navigate('/pipeline')}>前往待处理队列 →</Button>
            </Card>
          </div>

          <div className="dashboard-grid dashboard-grid--history">
            <Card className="dashboard-card" title="去重历史统计" extra={<Link to="/collection">查看去重历史详情 →</Link>}>
              <StatStrip items={[
                { key: 'total', label: '总条数', value: formatNumber(scanTotal) },
                { key: 'added', label: '最近新增（7 天）', value: formatNumber(lastSevenAdded) },
                { key: 'skipped', label: '重复过滤（7 天）', value: formatNumber(lastSevenSkipped) },
                { key: 'updated', label: '最近更新时间', value: scans[0]?.date ? dayjs(scans[0].date).format('MM-DD') : '—' },
              ]} />
            </Card>
            <Card className="dashboard-card" title="快捷操作记录">
              <EmptyState title="暂无操作记录" />
            </Card>
          </div>
        </div>

        <div className="dashboard-stack">
          <EnvironmentStatusCard className="dashboard-card" />

          <Card className="dashboard-card" title="最近活动">
            {activities.length ? <div className="dashboard-kv">{activities.map((item) => <div key={`${item.ts}-${item.type}-${item.summary}`}><span>{dayjs(item.ts).format('MM-DD HH:mm')} · {item.type}</span><strong>{item.summary}</strong></div>)}</div> : <EmptyState title="暂无最近活动" />}
          </Card>

          <Card className="dashboard-card" title="快捷入口">
            <div className="dashboard-quick-grid">
              <Button className="dashboard-quick" icon={<PlusCircleOutlined />} onClick={() => navigate('/collection')}>查看采集任务</Button>
              <Button className="dashboard-quick" icon={<FundProjectionScreenOutlined />} onClick={() => navigate('/pipeline')}>查看待处理队列</Button>
              <Button className="dashboard-quick" icon={<AuditOutlined />} onClick={() => navigate('/reports')}>查看评估报告</Button>
              <Button className="dashboard-quick" icon={<FilePdfOutlined />} onClick={() => navigate('/resumes')}>查看简历 PDF</Button>
            </div>
          </Card>

          {useDataStore.getState().error ? (
            <Card className="dashboard-card">
              <EmptyState icon={<WarningOutlined />} title="部分数据不可用" description="当前以 0 和空态降级显示" />
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  );
}
