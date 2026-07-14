import {
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  MergeOutlined,
  MoreOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Select,
  Skeleton,
  Slider,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { EmptyState, ScoreTag, StatusBadge } from '../components/common';
import { useDataStore } from '../stores/dataStore';
import type { Application, StateDefinition } from '../types';
import './tracker.css';

type ViewMode = 'kanban' | 'table';
type SalaryRange = { min: number | null; max: number | null };

const statusColors = [
  'var(--co-info-fg)',
  'var(--co-primary)',
  'var(--co-purple)',
  'var(--co-warning-fg)',
  'var(--co-success-fg)',
  'var(--co-danger-fg)',
  'var(--co-text-4)',
  'var(--co-text-disabled)',
];

function parseSalaryRange(value: string | null | undefined): SalaryRange {
  const range = String(value ?? '').trim().match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*(万|[kK])/);
  if (!range) return { min: null, max: null };
  const multiplier = range[3].toLowerCase() === 'k' ? 1_000 : 10_000;
  return { min: Number(range[1]) * multiplier, max: Number(range[2]) * multiplier };
}

function inferPlatform(item: Application) {
  if (item.platform) return item.platform;
  const url = item.jobUrl?.toLowerCase() ?? '';
  if (url.includes('zhipin')) return 'BOSS';
  if (url.includes('liepin')) return '猎聘';
  if (url.includes('zhaopin')) return '智联';
  if (url.includes('51job')) return '前程无忧';
  return '其他';
}

function downloadCsv(items: Application[]) {
  const headers = ['#', '公司', '职位', '方向', '薪资', '城市', '状态', '评分', '报告', 'PDF', '投递日期', '备注', '原始链接'];
  const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = items.map((item) => [
    item.num, item.company, item.role, item.direction, item.salary, item.city, item.status,
    item.score, item.reportPath, item.pdfGenerated ? '是' : '否', item.date, item.notes, item.jobUrl,
  ]);
  const blob = new Blob([`\uFEFF${[headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `applications-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Tracker() {
  const navigate = useNavigate();
  const [notice, noticeContext] = message.useMessage();
  const { loading: dataLoading, applications, states: rawStates, reloadApplications } = useDataStore();
  const states = useMemo(() => rawStates.filter((s: StateDefinition) => s.label), [rawStates]);
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [selected, setSelected] = useState<Application | null>(null);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedNotes, setSelectedNotes] = useState('');
  const [savingDetail, setSavingDetail] = useState(false);
  const [skipExpanded, setSkipExpanded] = useState(false);
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<number, string>>({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<string>();
  const [directionFilter, setDirectionFilter] = useState<string>();
  const [salaryFilter, setSalaryFilter] = useState<[number, number]>([0, 100]);
  const [selectedNums, setSelectedNums] = useState<React.Key[]>([]);
  const [batchStatus, setBatchStatus] = useState<string>();
  const [batchSaving, setBatchSaving] = useState(false);
  const [deletingDetail, setDeletingDetail] = useState(false);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [addCardStatus, setAddCardStatus] = useState('Evaluated');

  const effectiveApplications = useMemo(() => applications.map((item) => ({
    ...item,
    status: (optimisticStatuses[item.num] ?? item.status) as Application['status'],
  })), [applications, optimisticStatuses]);

  const filtered = useMemo(() => effectiveApplications.filter((item) => {
    const keyword = query.trim().toLocaleLowerCase();
    if (keyword && !`${item.company} ${item.role}`.toLocaleLowerCase().includes(keyword)) return false;
    if (statusFilter.length && !statusFilter.includes(item.status)) return false;
    if (platformFilter && inferPlatform(item) !== platformFilter) return false;
    if (directionFilter && item.direction !== directionFilter) return false;
    const salary = parseSalaryRange(item.salary);
    if (salary.min !== null && salary.max !== null) {
      if (salary.max < salaryFilter[0] * 1_000 || salary.min > salaryFilter[1] * 1_000) return false;
    }
    return true;
  }), [directionFilter, effectiveApplications, platformFilter, query, salaryFilter, statusFilter]);

  const parseDegraded = !dataLoading && (
    states.length === 0 ||
    applications.some((item) => !states.some((state) => state.label === item.status))
  );
  const stateLabels = states.flatMap((state) => state.label ? [state.label] : []);
  const directions = [...new Set(applications.flatMap((item) => item.direction ? [item.direction] : []))].sort();
  const platforms = [...new Set(applications.map(inferPlatform))].sort();

  // 只读看板：投递跟踪的写操作交给 Agent（tracker 模式）。这里给出可直接对 Agent 说的一句话。
  const askAgentTracker = (action: string) => {
    void notice.info(`该操作请交给 Agent 执行（tracker 模式）：${action}`);
  };

  const updateSelectedStatus = () => {
    if (!batchStatus || !selectedNums.length) return;
    askAgentTracker(`把 #${selectedNums.join('、#')} 的状态改为「${batchStatus}」`);
  };

  const handleDrop = (event: React.DragEvent, targetStatus: string) => {
    event.preventDefault();
    const num = Number(event.dataTransfer.getData('application-num'));
    if (!Number.isInteger(num)) return;
    const previous = effectiveApplications.find((item) => item.num === num)?.status;
    if (!previous || previous === targetStatus) return;
    askAgentTracker(`把 #${num} 的状态从「${previous}」改为「${targetStatus}」`);
  };

  const openDetail = (item: Application) => {
    setSelected(item);
    setSelectedStatus(item.status);
    setSelectedNotes(item.notes ?? '');
  };

  const saveDetail = () => {
    if (!selected) return;
    askAgentTracker(`更新 #${selected.num} ${selected.company}：状态「${selectedStatus}」，备注「${selectedNotes}」`);
  };

  const deleteDetail = () => {
    if (!selected) return;
    askAgentTracker(`从投递跟踪删除 #${selected.num} ${selected.company} · ${selected.role}`);
  };

  const createApplication = (values: { company: string; role: string; status: string; notes: string }) => {
    askAgentTracker(`新增投递：${values.company} · ${values.role}（状态「${values.status}」）`);
    setAddCardOpen(false);
  };

  const tableColumns: ColumnsType<Application> = [
    { title: '#', dataIndex: 'num', width: 56, sorter: (a, b) => a.num - b.num },
    { title: '公司', dataIndex: 'company', width: 150, ellipsis: true },
    { title: '职位', dataIndex: 'role', width: 190, ellipsis: true },
    { title: '方向', dataIndex: 'direction', width: 110, render: (value) => value ?? '—' },
    { title: '薪资', dataIndex: 'salary', width: 120, render: (value) => value ?? '—' },
    { title: '城市', dataIndex: 'city', width: 90, render: (value) => value ?? '—' },
    { title: '状态', dataIndex: 'status', width: 115, render: (value) => <StatusBadge status={value} definitions={states} /> },
    { title: '评分', dataIndex: 'score', width: 70, render: (value) => value ?? '—' },
    { title: '报告', dataIndex: 'reportPath', width: 70, align: 'center', render: (value) => value ? <FileTextOutlined /> : '—' },
    { title: '简历', dataIndex: 'pdfGenerated', width: 55, align: 'center', render: (value) => value ? <FilePdfOutlined className="tracker-pdf-icon" /> : '—' },
    { title: '投递日期', dataIndex: 'date', width: 110 },
    { title: '最后更新', dataIndex: 'date', width: 110 },
    { title: '备注', dataIndex: 'notes', width: 230, ellipsis: true, render: (value) => value || '—' },
    { title: '操作', fixed: 'right', width: 62, render: (_, item) => <Button type="text" icon={<MoreOutlined />} onClick={() => openDetail(item)} /> },
  ];

  if (dataLoading) {
    return (
      <main className="app-page tracker-page">
        <Skeleton active paragraph={{ rows: 1 }} />
        <Card><Skeleton active /></Card>
        <div className="tracker-loading-board">{Array.from({ length: 8 }, (_, index) => <Card key={index}><Skeleton active /></Card>)}</div>
      </main>
    );
  }

  return (
    <main className="app-page tracker-page">
      {noticeContext}
      <div className="tracker-head">
        <div>
          <h1>投递跟踪</h1>
          <p>跟踪所有职位的投递进展，及时更新状态</p>
        </div>
        <div className="tracker-actions">
        </div>
      </div>

      {useDataStore.getState().error ? <Alert className="tracker-alert" type="error" showIcon message="投递跟踪数据加载失败" description={useDataStore.getState().error} /> : null}
      {parseDegraded ? <Alert className="tracker-alert" type="warning" showIcon message="数据解析异常，已降级显示" /> : null}

      <Card className="tracker-filters">
        <div className="tracker-toolbar">
          <Space.Compact>
            <Button type={viewMode === 'kanban' ? 'primary' : 'default'} icon={<FundProjectionScreenOutlined />} onClick={() => setViewMode('kanban')}>看板视图</Button>
            <Button type={viewMode === 'table' ? 'primary' : 'default'} icon={<TableOutlined />} onClick={() => setViewMode('table')}>表格视图</Button>
          </Space.Compact>
          <Input className="tracker-search" allowClear prefix={<SearchOutlined />} placeholder="搜索公司 / 职位" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Select mode="multiple" maxTagCount={1} allowClear placeholder="状态" options={stateLabels.map((label) => ({ label, value: label }))} value={statusFilter} onChange={setStatusFilter} />
          <Select allowClear placeholder="平台" options={platforms.map((value) => ({ label: value, value }))} value={platformFilter} onChange={setPlatformFilter} />
          <Select allowClear placeholder="方向" options={directions.map((value) => ({ label: value, value }))} value={directionFilter} onChange={setDirectionFilter} />
          <div className="tracker-salary">
            <span>薪资：</span>
            <Slider range min={0} max={100} value={salaryFilter} onChange={(value) => setSalaryFilter(value as [number, number])} />
            <span>{salaryFilter[0]}K-{salaryFilter[1] === 100 ? '100K+' : `${salaryFilter[1]}K`}</span>
          </div>
        </div>
      </Card>

      {applications.length === 0 ? (
        <Card><EmptyState title="暂无投递记录" /></Card>
      ) : viewMode === 'kanban' ? (
        <section className="tracker-kanban" aria-label="投递看板">
          {states.map((state, index) => {
            const label = state.label!;
            const items = filtered.filter((item) => item.status === label);
            const isSkip = state.id?.toLowerCase() === 'skip' || state.dashboard_group?.toLowerCase() === 'skip';
            const collapsed = isSkip && !skipExpanded;
            return (
              <div
                className={`tracker-kanban__col${collapsed ? ' tracker-kanban__col--collapsed' : ''}`}
                data-state-label={label}
                key={state.id ?? label}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, label)}
              >
                <div className="tracker-kanban__bar" style={{ background: statusColors[index % statusColors.length] }} />
                <button className="tracker-kanban__head" type="button" onClick={() => isSkip && setSkipExpanded((current) => !current)}>
                  <span style={{ color: statusColors[index % statusColors.length] }}>{label}</span>
                  <span>{items.length}</span>
                  {isSkip ? <span>{collapsed ? '›' : '‹'}</span> : null}
                </button>
                {collapsed ? null : (
                  <>
                    <div className="tracker-kanban__cards">
                      {items.slice(0, 4).map((item) => (
                        <article
                          className="tracker-kcard"
                          draggable
                          key={item.num}
                          onDragStart={(event) => event.dataTransfer.setData('application-num', String(item.num))}
                          onClick={() => openDetail(item)}
                        >
                          <div className="tracker-kcard__company"><span>{item.company.slice(0, 1)}</span><em>{item.company}</em><MoreOutlined /></div>
                          <strong>{item.role}</strong>
                          <p>{item.salary ?? '—'} · {item.city ?? '—'}</p>
                          <div>{typeof item.score === 'number' ? <ScoreTag score={item.score} /> : '评分：—'}</div>
                          <p>更新：{item.date}</p>
                          <p className="tracker-kcard__note">备注：{item.notes || '—'}</p>
                        </article>
                      ))}
                      {items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记录" /> : null}
                    </div>
                    {items.length > 4 ? <div className="tracker-kanban__more">+ {items.length - 4} 张卡片</div> : null}
                  </>
                )}
              </div>
            );
          })}
        </section>
      ) : (
        <Card className="tracker-table-card" title={`所有记录（共 ${filtered.length} 条）`}>
          <Table
            rowKey="num"
            columns={tableColumns}
            dataSource={filtered}
            rowSelection={{ selectedRowKeys: selectedNums, onChange: setSelectedNums }}
            scroll={{ x: 1750 }}
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: true }}
            onRow={(item) => ({ onDoubleClick: () => openDetail(item) })}
          />
        </Card>
      )}

      <Drawer className="tracker-drawer" width={390} open={selected !== null} onClose={() => setSelected(null)} title={selected ? `${selected.company} · ${selected.role}` : '投递详情'} closeIcon={<CloseOutlined />}>
        {selected ? (
          <>
            <h3>基本信息</h3>
            <div className="tracker-detail-kv">
              {[
                ['编号', selected.num],
                ['公司', selected.company],
                ['职位', selected.role],
                ['方向', selected.direction ?? '—'],
                ['薪资范围', selected.salary ?? '—'],
                ['城市', selected.city ?? '—'],
                ['评分', selected.score ?? '—'],
                ['原始评分', selected.scoreRaw ?? '—'],
                ['投递日期', selected.date],
                ['来源平台', inferPlatform(selected)],
                ['报告编号', selected.reportNumber ?? '—'],
                ['报告路径', selected.reportPath ?? '—'],
                ['PDF', selected.pdfGenerated ? '已生成' : '未生成'],
                ['原始链接', selected.jobUrl ?? '—'],
              ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
              <div><span>状态</span><Select value={selectedStatus} onChange={setSelectedStatus} options={stateLabels.map((label) => ({ label, value: label }))} /></div>
            </div>
            <Button type="primary" block className="tracker-interview-button" onClick={() => navigate(`/interview-prep?application=${selected.num}`)}>面试准备</Button>
          </>
        ) : null}
      </Drawer>

    </main>
  );
}
