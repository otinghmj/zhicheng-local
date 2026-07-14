import {
  DeleteOutlined,
  FilterOutlined,
  LinkOutlined,
  MergeOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Drawer, Form, Input, message, Modal, Select, Skeleton, Table, Tabs, Tag, Tooltip } from 'antd';
import type { ColumnsType, TableRowSelection } from 'antd/es/table/interface';
import { useMemo, useState } from 'react';

import { EmptyState, PlatformChip, ScoreTag, StatStrip } from '../components/common';
import type { PlatformChipVariant } from '../components/common';
import { useDataStore } from '../stores/dataStore';
import type { PipelineParsedItem } from '../types';
import './pipeline.css';

type StatusTab = 'all' | 'pending' | 'processed';

type PipelineRow = PipelineParsedItem & {
  key: string;
  statusLabel: '待处理' | '已处理';
  inferredPlatform: string;
  platformVariant: PlatformChipVariant;
  domain: string;
};

const numberFormat = new Intl.NumberFormat('zh-CN');

function inferPlatform(url: string) {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    if (domain.endsWith('liepin.com')) return { name: '猎聘', variant: 'liepin' as const, domain };
    if (domain.endsWith('zhipin.com')) return { name: 'BOSS', variant: 'boss' as const, domain };
    if (domain.endsWith('zhaopin.com')) return { name: '智联', variant: 'zhaopin' as const, domain };
    if (domain.endsWith('51job.com')) return { name: '前程无忧', variant: '51job' as const, domain };
    if (domain.endsWith('lagou.com')) return { name: '拉勾', variant: 'lagou' as const, domain };
    return { name: domain, variant: 'boss' as const, domain };
  } catch {
    return { name: '其他', variant: 'boss' as const, domain: '无效链接' };
  }
}

function makeRows(items: PipelineParsedItem[], statusLabel: PipelineRow['statusLabel']): PipelineRow[] {
  return items.map((item, index) => {
    const platform = inferPlatform(item.url);
    return {
      ...item,
      key: `${statusLabel}-${index}-${item.url}`,
      statusLabel,
      inferredPlatform: platform.name,
      platformVariant: platform.variant,
      domain: platform.domain,
    };
  });
}

function estimateScoreBreakdown(row: PipelineRow) {
  const score = row.preFilterScore;
  const role = (row.role ?? '').toLowerCase();
  const industry = (row.industry ?? '').toLowerCase();
  const salary = row.salary ?? '';

  let direction = 0;
  const primaryKeywords = ['ai应用', '工业ai', '知识图谱', '工业软件', 'llm', 'rag', 'ai agent', '大模型'];
  const secondaryKeywords = ['技术项目经理', '研发项目经理', '制造数字化', '数字化项目经理', '解决方案'];
  if (primaryKeywords.some((kw) => role.includes(kw))) direction = 2;
  else if (secondaryKeywords.some((kw) => role.includes(kw))) direction = 1;

  let salaryScore = 1;
  const salaryMatch = salary.match(/(\d+(?:\.\d+)?)[k-]+(\d+(?:\.\d+)?)[kK]/i);
  if (salaryMatch) {
    const upper = parseFloat(salaryMatch[2]);
    if (upper >= 30) salaryScore = 2;
    else if (upper >= 20) salaryScore = 1;
    else salaryScore = 0;
  } else if (salary.includes('面议')) {
    salaryScore = 1;
  }

  const industryKeywords = ['制造', '工业', '智能制造', '自动化', '工业软件', '数字化', '新能源', '半导体', 'ai', '大模型', '科技'];
  const industryScore = industryKeywords.some((kw) => industry.includes(kw)) ? 1 : 0;

  const estimated = direction + salaryScore + industryScore;
  const diff = score - estimated;
  if (Math.abs(diff) > 0.5) {
    if (diff > 0) salaryScore = Math.min(2, salaryScore + Math.round(diff));
    else direction = Math.max(0, direction + Math.round(diff));
  }

  return { direction: Math.min(2, Math.max(0, direction)), salary: Math.min(2, Math.max(0, salaryScore)), industry: Math.min(1, Math.max(0, industryScore)) };
}

const DIRECTION_LABELS = ['与目标方向无关', '命中次要目标', '直接命中主要目标'];
const SALARY_LABELS = ['明显低于目标', '薪资未披露/略低于目标', '与目标区间有明确重叠'];
const INDUSTRY_LABELS = ['非目标行业', '目标行业/AI科技属性'];

export function Pipeline() {
  const [notice, noticeContext] = message.useMessage();
  const { loading: dataLoading, error: dataError, pipeline: pipelineData, scanHistory: scanHistoryData } = useDataStore();
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState<string>();
  const [industry, setIndustry] = useState<string>();
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [detailRow, setDetailRow] = useState<PipelineRow | null>(null);
  const [addUrlOpen, setAddUrlOpen] = useState(false);
  const [addingUrl, setAddingUrl] = useState(false);
  const [addForm] = Form.useForm<{ url: string; company?: string; role?: string }>();

  const loadState = dataLoading ? 'loading' as const : dataError ? 'error' as const : 'ready' as const;

  const pendingRows = useMemo(() => makeRows(pipelineData.pending as PipelineParsedItem[], '待处理'), [pipelineData.pending]);
  const processedRows = useMemo(() => makeRows(pipelineData.processed as PipelineParsedItem[], '已处理'), [pipelineData.processed]);
  const allRows = useMemo(() => [...pendingRows, ...processedRows], [pendingRows, processedRows]);
  const rowsForTab = statusTab === 'pending' ? pendingRows : statusTab === 'processed' ? processedRows : allRows;
  const filteredRows = useMemo(() => rowsForTab.filter((row) => {
    const keyword = query.trim().toLocaleLowerCase();
    if (keyword && !`${row.company} ${row.role} ${row.city} ${row.url}`.toLocaleLowerCase().includes(keyword)) return false;
    if (platform && row.inferredPlatform !== platform) return false;
    if (industry && row.industry !== industry) return false;
    return true;
  }), [industry, platform, query, rowsForTab]);

  const platforms = [...new Set(allRows.map((row) => row.inferredPlatform))].sort();
  const industries = [...new Set(allRows.map((row) => row.industry).filter(Boolean))].sort();
  const showScoreColumn = allRows.some((row) => row.preFilterScore !== 5);
  const pendingCount = pendingRows.length;
  const processedCount = processedRows.length;
  const total = pendingCount + processedCount;
  const averageScore = allRows.length ? allRows.reduce((sum, row) => sum + row.preFilterScore, 0) / allRows.length : 0;
  const skipped = scanHistoryData.filter((row) => row.status.startsWith('skipped_')).length;
  const dedupRate = scanHistoryData.length ? (skipped / scanHistoryData.length) * 100 : 0;
  const parseDegraded = false;
  const selectedRows = allRows.filter((row) => selectedKeys.includes(row.key));

  const exportCsv = () => {
    const headers = ['公司', '职位', '薪资', '城市', '行业', '状态', 'URL'];
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const content = [headers, ...filteredRows.map((row) => [row.company, row.role, row.salary, row.city, row.industry, row.statusLabel, row.url])]
      .map((row) => row.map(escape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // 只读看板：队列的增/删/处理都交给 Agent，这里给出可直接对 Agent 说的一句话。
  const addUrl = async (values: { url: string; company?: string; role?: string }) => {
    void notice.info(`添加请对 Agent 说：把 ${values.url} 加入待处理队列（pipeline）`);
    addForm.resetFields();
    setAddUrlOpen(false);
  };

  const askAgentPipeline = (action: string) => {
    void notice.info(`该操作请交给 Agent 执行（pipeline 模式）：${action}`);
  };

  const writePipeline = (body: { remove?: string[]; updates?: Array<{ url: string; processed: boolean }> }) => {
    if (body.remove?.length) askAgentPipeline(`移除 ${body.remove.length} 条并写入扫描历史`);
    else askAgentPipeline(`标记 ${body.updates?.length ?? 0} 条的处理状态`);
    setSelectedKeys([]);
  };

  const removeSelected = () => {
    if (!selectedRows.length) return;
    askAgentPipeline(`移除选中的 ${selectedRows.length} 条记录`);
  };

  const columns: ColumnsType<PipelineRow> = [
    {
      title: '平台',
      dataIndex: 'inferredPlatform',
      width: 64,
      render: (_, row) => <PlatformChip variant={row.platformVariant} label={row.inferredPlatform === '其他' || row.domain === row.inferredPlatform ? '其' : undefined} title={row.inferredPlatform} />,
    },
    { title: '公司', dataIndex: 'company', width: 150, ellipsis: true },
    { title: '职位', dataIndex: 'role', width: 210, ellipsis: true },
    { title: '薪资', dataIndex: 'salary', width: 110, ellipsis: true },
    { title: '城市', dataIndex: 'city', width: 110, ellipsis: true },
    { title: '经验', dataIndex: 'experience', width: 90, ellipsis: true },
    { title: '学历', dataIndex: 'education', width: 90, ellipsis: true },
    { title: '行业', dataIndex: 'industry', width: 130, ellipsis: true },
    { title: '规模', dataIndex: 'companySize', width: 110, ellipsis: true },
    ...(showScoreColumn ? [{
      title: '初筛分',
      dataIndex: 'preFilterScore',
      width: 135,
      render: (value: number) => <ScoreTag score={value} />,
      sorter: (left: PipelineRow, right: PipelineRow) => left.preFilterScore - right.preFilterScore,
    }] : []),
    {
      title: 'URL 来源',
      dataIndex: 'url',
      width: 145,
      ellipsis: true,
      render: (_, row) => <a href={row.url} target="_blank" rel="noreferrer" title={row.url}>{row.domain}</a>,
    },
    { title: '状态', dataIndex: 'statusLabel', width: 105, render: (value) => <Tag color={value === '待处理' ? 'orange' : 'success'}>{value}</Tag> },
  ];

  const rowSelection: TableRowSelection<PipelineRow> = {
    selectedRowKeys: selectedKeys,
    onChange: setSelectedKeys,
  };

  if (loadState === 'loading') {
    return (
      <main className="app-page pipeline-page">
        <div className="pipeline-head"><Skeleton active paragraph={{ rows: 1 }} /><Card><Skeleton active paragraph={{ rows: 1 }} /></Card></div>
        <div className="pipeline-layout"><Card><Skeleton active paragraph={{ rows: 12 }} /></Card><div className="pipeline-stack"><Card><Skeleton active /></Card><Card><Skeleton active /></Card></div></div>
      </main>
    );
  }

  return (
    <main className="app-page pipeline-page">
      {noticeContext}
      <div className="pipeline-head">
        <div className="pipeline-title">
          <h1>待处理队列</h1>
          <p>管理待处理的职位，进行初筛和评估</p>
        </div>
        <Card className="pipeline-stat-card">
          <StatStrip items={[
            { key: 'pending', label: '待处理', value: numberFormat.format(pendingCount), tone: 'primary' },
            { key: 'processed', label: '已处理', value: numberFormat.format(processedCount) },
            { key: 'total', label: '总计', value: numberFormat.format(total) },
            { key: 'last', label: '最近处理', value: '—' },
          ]} />
        </Card>
      </div>

      {loadState === 'error' ? <Alert className="pipeline-alert" type="error" showIcon message="队列数据加载失败" description="请确认 Web API 服务已启动后刷新页面。" /> : null}
      {parseDegraded ? <Alert className="pipeline-alert" type="warning" showIcon message="数据解析异常，已降级显示" /> : null}

      {loadState === 'error' ? <Card><EmptyState title="暂无可显示数据" /></Card> : (
        <div className="pipeline-layout">
          <div className="pipeline-stack">
            <Card className="pipeline-table-card">
              <Tabs
                activeKey={statusTab}
                onChange={(key) => setStatusTab(key as StatusTab)}
                items={[
                  { key: 'all', label: <>全部 <span className="pipeline-tab-count">{numberFormat.format(total)}</span></> },
                  { key: 'pending', label: <>待处理 <span className="pipeline-tab-count">{numberFormat.format(pendingCount)}</span></> },
                  { key: 'processed', label: <>已处理 <span className="pipeline-tab-count">{numberFormat.format(processedCount)}</span></> },
                ]}
              />
              <div className="pipeline-toolbar">
                <Input allowClear prefix={<SearchOutlined />} placeholder="搜索公司 / 职位 / 城市" value={query} onChange={(event) => setQuery(event.target.value)} />
                <Select allowClear placeholder="所有平台" value={platform} onChange={setPlatform} options={platforms.map((value) => ({ label: value, value }))} />
                <Select allowClear placeholder="所有行业" value={industry} onChange={setIndustry} options={industries.map((value) => ({ label: value, value }))} />
                <span>共 {numberFormat.format(filteredRows.length)} 条</span>
              </div>
              <Table
                rowKey="key"
                columns={columns}
                dataSource={filteredRows}
                size="small"
                scroll={{ x: showScoreColumn ? 1570 : 1435 }}
                pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (count) => `共 ${numberFormat.format(count)} 条` }}
                onRow={(row) => ({ onClick: (e) => { if ((e.target as HTMLElement).closest('.ant-checkbox-wrapper, .ant-table-selection-column')) return; setDetailRow(row); }, style: { cursor: 'pointer' } })}
              />
            </Card>

            <div className="pipeline-notes">
              <Card title="使用说明"><ul><li>待处理职位等待深度评估</li><li>已处理职位已完成评估流程</li><li>移除记录会写入扫描历史以避免重复</li></ul></Card>
              <Card title="查看提示"><ul><li>支持平台、行业和关键词筛选</li><li>表格使用分页，避免一次渲染全部数据</li><li>新增、处理和移除职位请通过 AI Agent 执行</li></ul></Card>
              <Card title="数据口径"><ul><li>平台字标由 URL 域名推断</li><li>去重率来自 scan-history</li><li>初筛分列仅在存在非 5 分时展示</li></ul></Card>
            </div>
          </div>

          <div className="pipeline-stack">
            <Card title="队列统计">
              <div className="pipeline-kv">
                <div><span>待处理</span><strong className="pipeline-primary">{numberFormat.format(pendingCount)}</strong></div>
                <div><span>已处理</span><strong>{numberFormat.format(processedCount)}</strong></div>
                <div><span>总计</span><strong>{numberFormat.format(total)}</strong></div>
                <div><span>平均初筛分</span><strong>{averageScore.toFixed(2)} / 5</strong></div>
                <div><span>去重过滤率</span><strong>{dedupRate.toFixed(1)}%</strong></div>
              </div>
            </Card>
          </div>
        </div>
      )}
      <Drawer
        title={detailRow ? `${detailRow.company} — ${detailRow.role}` : '详情'}
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        width={520}
      >
        {detailRow && (() => {
          const bd = estimateScoreBreakdown(detailRow);
          return (
            <>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="平台">{detailRow.inferredPlatform}</Descriptions.Item>
                <Descriptions.Item label="公司">{detailRow.company || '—'}</Descriptions.Item>
                <Descriptions.Item label="职位">{detailRow.role || '—'}</Descriptions.Item>
                <Descriptions.Item label="薪资">{detailRow.salary || '—'}</Descriptions.Item>
                <Descriptions.Item label="城市">{detailRow.city || '—'}</Descriptions.Item>
                <Descriptions.Item label="经验">{detailRow.experience || '—'}</Descriptions.Item>
                <Descriptions.Item label="学历">{detailRow.education || '—'}</Descriptions.Item>
                <Descriptions.Item label="行业">{detailRow.industry || '—'}</Descriptions.Item>
                <Descriptions.Item label="公司规模">{detailRow.companySize || '—'}</Descriptions.Item>
                <Descriptions.Item label="状态"><Tag color={detailRow.statusLabel === '待处理' ? 'orange' : 'success'}>{detailRow.statusLabel}</Tag></Descriptions.Item>
                <Descriptions.Item label="URL"><a href={detailRow.url} target="_blank" rel="noreferrer"><LinkOutlined /> {detailRow.domain}</a></Descriptions.Item>
              </Descriptions>

              <Card size="small" title={<>初筛评分 <ScoreTag score={detailRow.preFilterScore} /></>} style={{ marginTop: 16 }}>
                <div className="pipeline-score-breakdown">
                  <div className="pipeline-score-dim">
                    <div className="pipeline-score-dim__header"><span>方向契合度</span><strong>{bd.direction}/2</strong></div>
                    <div className="pipeline-score-dim__bar"><div style={{ width: `${(bd.direction / 2) * 100}%` }} /></div>
                    <span className="pipeline-score-dim__label">{DIRECTION_LABELS[bd.direction]}</span>
                  </div>
                  <div className="pipeline-score-dim">
                    <div className="pipeline-score-dim__header"><span>薪资匹配度</span><strong>{bd.salary}/2</strong></div>
                    <div className="pipeline-score-dim__bar"><div style={{ width: `${(bd.salary / 2) * 100}%` }} /></div>
                    <span className="pipeline-score-dim__label">{SALARY_LABELS[bd.salary]}</span>
                  </div>
                  <div className="pipeline-score-dim">
                    <div className="pipeline-score-dim__header"><span>行业加成</span><strong>{bd.industry}/1</strong></div>
                    <div className="pipeline-score-dim__bar"><div style={{ width: `${bd.industry * 100}%` }} /></div>
                    <span className="pipeline-score-dim__label">{INDUSTRY_LABELS[bd.industry]}</span>
                  </div>
                </div>
                <p className="pipeline-score-note">初筛基于职位名、薪资区间和行业标签进行三维评分（满分 5 分），≥3 分通过初筛。维度明细为近似推算，实际评分以采集时 AI 判定为准。</p>
              </Card>

            </>
          );
        })()}
      </Drawer>

    </main>
  );
}
