import {
  FileMarkdownOutlined,
  FilePdfOutlined,
  LinkOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Input, message, Modal, Segmented, Skeleton, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { EmptyState, ScoreTag, StatusBadge } from '../components/common';
import { readFile, writeFile, listFiles } from '../lib/fs';
import { appendApplicationRow, appendApplicationContent } from '../lib/writers';
import { useAiTask } from '../hooks/useAiTask';
import { useDataStore } from '../stores/dataStore';
import { useFsStore } from '../stores/fsStore';
import type {
  Application,
  EvaluationReportDetail,
  EvaluationReportSummary,
  PdfFile,
  ReportSection,
  ReportScores,
} from '../types';
import './reports.css';

type LoadState = 'loading' | 'ready' | 'error';
type DetailState = 'idle' | 'loading' | 'ready' | 'error';
type ReportRow = EvaluationReportSummary & { application?: Application; rootLoose: boolean };
type SectionKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'overall' | 'nextSteps';

const ROOT_LOOSE = '__root__';
const DIMENSIONS: Array<{ key: keyof ReportScores; section: SectionKey; label: string }> = [
  { key: 'cv_match', section: 'A', label: 'A CV 匹配度' },
  { key: 'direction', section: 'B', label: 'B 方向契合度' },
  { key: 'salary', section: 'C', label: 'C 薪资水平' },
  { key: 'company', section: 'D', label: 'D 公司信号' },
  { key: 'red_flags', section: 'E', label: 'E 红旗项' },
];
const SECTION_TABS: Array<{ key: SectionKey; label: string }> = [
  ...DIMENSIONS.map(({ section: key, label }) => ({ key, label })),
  { key: 'overall', label: '综合评估' },
  { key: 'nextSteps', label: '建议下一步' },
];
const QUALITATIVE = /(非常高|较高|中等|一般|较低|高|低)/;

function recommendation(score: number | undefined) {
  if (score === undefined) return { label: '未评分', color: 'default' };
  if (score >= 4.5) return { label: '强匹配，建议立即投递', color: 'success' };
  if (score >= 4) return { label: '匹配良好，值得投递', color: 'processing' };
  if (score >= 3.5) return { label: '尚可但不理想，有特定理由再投', color: 'warning' };
  return { label: '不建议投递', color: 'error' };
}

function cleanMarkdownLine(line: string) {
  const plain = line.replace(/^[-*>\d.\s]+/, '').replace(/\*\*|__|`/g, '').replace(/\[(.+?)]\(.+?\)/g, '$1').trim();
  if (plain.startsWith('|') && plain.endsWith('|')) return plain.split('|').map((cell) => cell.trim()).filter(Boolean).join('：');
  return plain;
}

function firstPoint(section?: ReportSection) {
  return section?.markdown?.split(/\r?\n/)
    .filter((line) => !/^\s*\|?\s*(?:维度|JD要求|#|板块|数据|内容)\s*\|/i.test(line))
    .filter((line) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(line))
    .map(cleanMarkdownLine)
    .find((line) => line && !/^\d(?:\.\d)?\s*\/\s*5$/.test(line)) ?? '暂无摘要';
}

function qualitativeLevel(section?: ReportSection) {
  const markdown = section?.markdown ?? '';
  const value = markdown.match(QUALITATIVE)?.[1] ?? markdown.match(/(?:^|[\s：:（(])(中)(?:$|[\s，,。；;）)])/m)?.[1];
  if (!value) return null;
  if (['非常高', '较高', '高'].includes(value)) return 'high';
  if (['中等', '中', '一般'].includes(value)) return 'middle';
  return 'low';
}

function reportSlug(reportPath?: string) {
  return reportPath?.split('/').at(-1)?.replace(/\.md$/, '').replace(/^\d+-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '') ?? '';
}

function normalize(value: string | null | undefined) {
  return String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function findPdf(report: EvaluationReportSummary, files: PdfFile[]) {
  const company = normalize(report.company);
  return files.find((file) => file.date === report.date && normalize(file.filename).includes(company));
}

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function SummaryVisual({ detail }: { detail: EvaluationReportDetail }) {
  if (detail.scores) {
    return (
      <ReactECharts
        className="reports-radar"
        option={{
          tooltip: {},
          radar: {
            indicator: DIMENSIONS.map(({ label }) => ({ name: label, max: 5 })),
            radius: '62%',
            splitNumber: 5,
            axisName: { color: '#6b7280', fontSize: 11 },
          },
          series: [{
            type: 'radar',
            data: [{ value: DIMENSIONS.map(({ key }) => detail.scores?.[key] ?? 0), name: 'A–E 评分' }],
            areaStyle: { color: 'rgba(45, 108, 223, .18)' },
            lineStyle: { color: '#2D6CDF' },
            itemStyle: { color: '#2D6CDF' },
          }],
        }}
      />
    );
  }

  return (
    <div className="reports-summary-list">
      {DIMENSIONS.map(({ label, section }) => {
        const level = qualitativeLevel(detail.sections?.[section]);
        return (
          <article className="reports-summary-item" key={section}>
            <strong>{label}</strong>
            <span>{firstPoint(detail.sections?.[section])}</span>
            {level ? (
              <i className={`reports-level reports-level--${level}`}><b />{level === 'high' ? '高' : level === 'middle' ? '中' : '低'}</i>
            ) : (
              <Tooltip title="报告文字中没有可直接提取的高 / 中 / 低定性结论">
                <i className="reports-level reports-level--unknown"><b />未识别</i>
              </Tooltip>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function Reports() {
  const [notice, noticeContext] = message.useMessage();
  const { loading: dataLoading, error: dataError, reports, applications, reloadApplications, reloadReports, getReportDetail } = useDataStore();
  const dirHandle = useFsStore((s) => s.dirHandle);
  const [detailState, setDetailState] = useState<DetailState>('idle');
  const [pdfFiles, setPdfFiles] = useState<PdfFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [detail, setDetail] = useState<EvaluationReportDetail>();
  const [direction, setDirection] = useState('all');
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<SectionKey>('A');
  const [compareMode, setCompareMode] = useState(false);
  const [compareKeys, setCompareKeys] = useState<React.Key[]>([]);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareContent, setCompareContent] = useState<string>('');

  const aiTask = useAiTask();
  const loadState = dataLoading ? 'loading' as const : dataError ? 'error' as const : 'ready' as const;

  useEffect(() => {
    if (aiTask.status.state === 'completed') {
      void reloadReports(dirHandle);
      void reloadApplications(dirHandle);
      void notice.success('AI 任务已完成');
    }
    if (aiTask.status.state === 'failed') {
      void notice.error(aiTask.status.error ?? 'AI 任务执行失败');
    }
  }, [aiTask.status.state, aiTask.status.error, notice, dirHandle, reloadReports, reloadApplications]);

  const generatePdf = () => {
    if (!detail?.url) return;
    void aiTask.start('pdf', detail.url);
  };

  const addToTracker = async () => {
    if (!detail || !dirHandle) return;
    const alreadyTracked = applications.some((app) => app.company === detail.company && app.role === detail.role);
    if (alreadyTracked) {
      void notice.warning('该公司+职位已在 Tracker 中');
      return;
    }
    try {
      const content = await readFile(dirHandle, 'data/applications.md');
      const result = appendApplicationRow(content, {
        date: detail.date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
        company: detail.company ?? '未知公司',
        role: detail.role ?? '未知职位',
        score: detail.score,
        status: 'Evaluated',
        pdfGenerated: !!pdfFiles.find((pdf) => pdf.date === detail.date && normalize(pdf.filename).includes(normalize(detail.company ?? ''))),
        reportPath: detail.reportPath,
        notes: '',
      });
      const row = (result as Application & { _appendedRow: string })._appendedRow;
      await writeFile(dirHandle, 'data/applications.md', appendApplicationContent(content, row));
      await reloadApplications(dirHandle);
      void notice.success(`已入库 #${result.num} ${result.company}`);
    } catch (error) {
      void notice.error(error instanceof Error ? error.message : '入库失败');
    }
  };

  useEffect(() => {
    if (!dataLoading && reports.length && !selectedPath) {
      setSelectedPath(reports[0]?.reportPath);
    }
  }, [dataLoading, reports, selectedPath]);

  useEffect(() => {
    if (!dirHandle) return;
    void (async () => {
      try {
        const pdfNames = await listFiles(dirHandle, 'output');
        const pdfs: PdfFile[] = pdfNames
          .filter((n) => n.endsWith('.pdf'))
          .map((filename) => {
            const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
            return { filename, date: dateMatch?.[1] ?? '', size: 0, mtime: dateMatch?.[1] ?? '' };
          });
        setPdfFiles(pdfs);
      } catch { /* no output dir yet */ }
    })();
  }, [dirHandle, reports]);

  useEffect(() => {
    const selectedReport = reports.find((report) => report.reportPath === selectedPath);
    if (selectedReport?.num === undefined || !dirHandle) return;
    let active = true;
    setDetailState('loading');
    setActiveSection('A');
    void getReportDetail(dirHandle, selectedReport.reportPath ?? '')
      .then((value) => {
        if (!active) return;
        if (value) {
          setDetail(value);
          setDetailState('ready');
        } else {
          setDetailState('error');
        }
      })
      .catch(() => active && setDetailState('error'));
    return () => { active = false; };
  }, [reports, selectedPath, dirHandle, getReportDetail]);

  const applicationByReport = useMemo(() => {
    const byPath = new Map<string, Application>();
    const byNumber = new Map<number, Application>();
    for (const application of applications) {
      if (application.reportPath) byPath.set(application.reportPath, application);
      const reportNumber = Number(application.reportNumber);
      if (!application.reportPath && Number.isFinite(reportNumber)) byNumber.set(reportNumber, application);
    }
    return { byNumber, byPath };
  }, [applications]);

  const rows = useMemo<ReportRow[]>(() => reports.map((report) => ({
    ...report,
    application: applicationByReport.byPath.get(report.reportPath ?? '')
      ?? (report.num === undefined ? undefined : applicationByReport.byNumber.get(report.num)),
    rootLoose: !report.direction,
  })), [applicationByReport, reports]);

  const directionTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const report of rows) {
      const key = report.rootLoose ? ROOT_LOOSE : report.direction!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [
      { value: 'all', label: `全部 ${rows.length}` },
      ...[...counts].map(([value, count]) => ({ value, label: `${value === ROOT_LOOSE ? '根目录散件' : value} ${count}` })),
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return rows.filter((report) => {
      if (direction === ROOT_LOOSE && !report.rootLoose) return false;
      if (direction !== 'all' && direction !== ROOT_LOOSE && report.direction !== direction) return false;
      return !keyword || `${report.company} ${report.role}`.toLocaleLowerCase().includes(keyword);
    });
  }, [direction, query, rows]);

  useEffect(() => {
    if (filtered.length && !filtered.some((item) => item.reportPath === selectedPath)) setSelectedPath(filtered[0].reportPath);
  }, [filtered, selectedPath]);

  const selectedRow = rows.find((item) => item.reportPath === selectedPath);
  const selectedApplication = selectedRow?.application;
  const selectedPdf = selectedRow ? findPdf(selectedRow, pdfFiles) : undefined;
  const slug = reportSlug(selectedRow?.reportPath);
  const recommendationMeta = recommendation(detail?.score);

  const toggleCompareKey = (key: string) => {
    setCompareKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : prev.length < 5 ? [...prev, key] : prev);
  };

  const columns: ColumnsType<ReportRow> = [
    {
      title: compareMode ? <Checkbox checked={compareKeys.length === filtered.length} indeterminate={compareKeys.length > 0 && compareKeys.length < filtered.length} onChange={() => setCompareKeys(compareKeys.length === filtered.length ? [] : filtered.map((r) => r.reportPath ?? String(r.num)))} /> : null,
      width: 44,
      render: (_, item) => compareMode ? <Checkbox checked={compareKeys.includes(item.reportPath ?? String(item.num))} onChange={() => toggleCompareKey(item.reportPath ?? String(item.num))} /> : null,
    },
    { title: '编号', dataIndex: 'num', width: 68, render: (value) => value === undefined ? '—' : `#${value}` },
    { title: '公司', dataIndex: 'company', width: 135, ellipsis: true },
    { title: '职位', dataIndex: 'role', ellipsis: true },
    { title: '评分', dataIndex: 'score', width: 118, render: (value) => typeof value === 'number' ? <ScoreTag score={value} /> : '—' },
    { title: '日期', dataIndex: 'date', width: 108 },
    { title: '简历', width: 74, align: 'center', render: (_, item) => findPdf(item, pdfFiles) ? <Tag color="success">已生成</Tag> : <Tag>未生成</Tag> },
    { title: '跟踪状态', width: 105, render: (_, item) => item.application ? <StatusBadge status={item.application.status} /> : <Tag>未入库</Tag> },
  ];

  if (loadState === 'loading') {
    return <main className="app-page reports-page"><Skeleton active /><div className="reports-layout"><Card><Skeleton active /></Card><Card><Skeleton active /></Card></div></main>;
  }

  return (
    <main className="app-page reports-page">
      {noticeContext}
      <div className="reports-head">
        <div><h1>评估报告</h1><p>基于 A–E 五维分析，查看岗位匹配度与下一步建议</p></div>
        <div className="reports-actions">
          <Button
            icon={<ReloadOutlined />}
            disabled={!detail?.url || aiTask.status.state === 'running'}
            loading={aiTask.status.state === 'running'}
            onClick={() => {
              if (!detail?.url) return;
              void aiTask.start('oferta', detail.url);
            }}
          >
            {aiTask.status.state === 'running' ? '评估中…' : '重新评估'}
          </Button>
          <Button
            icon={<FilePdfOutlined />}
            disabled={!detail?.url || aiTask.status.state === 'running'}
            onClick={generatePdf}
          >
            生成 PDF
          </Button>
          <Button
            icon={<SendOutlined />}
            disabled={!detail || !!selectedApplication}
            onClick={() => void addToTracker()}
          >
            {selectedApplication ? '已入库' : '入库 Tracker'}
          </Button>
        </div>
      </div>

      {loadState === 'error' ? <Alert type="error" showIcon message="评估报告加载失败" description="请确认 Web API 服务已启动后刷新页面。" /> : null}

      {loadState === 'error' ? (
        <Card><EmptyState title="暂无可显示数据" /></Card>
      ) : reports.length === 0 ? (
        <Card><EmptyState title="暂无评估报告" description="reports/ 目录中还没有可读取的报告。" /></Card>
      ) : (
        <>
          <Segmented className="reports-direction-tabs" options={directionTabs} value={direction} onChange={(value) => setDirection(String(value))} />


          <Modal
            title="多项对比分析"
            open={compareModalOpen}
            onCancel={() => setCompareModalOpen(false)}
            footer={null}
            width={800}
            destroyOnHidden
          >
            <div className="reports-markdown" style={{ maxHeight: 520, overflow: 'auto' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{compareContent}</ReactMarkdown>
            </div>
          </Modal>

          <div className="reports-layout">
            <Card className="reports-list-card">
              <div className="reports-toolbar">
                <Input allowClear prefix={<SearchOutlined />} placeholder="搜索公司 / 职位" value={query} onChange={(event) => setQuery(event.target.value)} />
                {compareMode ? (
                  <>
                    <Button
                      type="primary"
                      icon={<SwapOutlined />}
                      disabled={compareKeys.length < 2 || aiTask.status.state === 'running'}
                      loading={aiTask.status.state === 'running' && aiTask.status.jobId !== null}
                      onClick={async () => {
                        const nums = compareKeys.map((key) => {
                          const row = rows.find((r) => (r.reportPath ?? String(r.num)) === key);
                          return String(row?.num ?? '');
                        }).filter(Boolean);
                        const result = await aiTask.start('ofertas', nums.join(','));
                        if ('error' in result) void notice.error(result.error);
                      }}
                    >
                      对比 {compareKeys.length} 份
                    </Button>
                    <Button onClick={() => { setCompareMode(false); setCompareKeys([]); }}>取消</Button>
                  </>
                ) : (
                  <Button icon={<SwapOutlined />} onClick={() => setCompareMode(true)}>多选对比</Button>
                )}
              </div>
              <Table
                columns={columns}
                dataSource={filtered}
                rowKey={(item) => item.reportPath ?? String(item.num)}
                size="small"
                pagination={{ pageSize: 10, showSizeChanger: false }}
                locale={{ emptyText: <EmptyState title="当前筛选下暂无报告" /> }}
                onRow={(item) => ({ onClick: () => setSelectedPath(item.reportPath), className: item.reportPath === selectedPath ? 'reports-row--selected' : '' })}
              />
              <div className="reports-score-note">
                <strong>评分说明（A–E 五维）</strong>
                <span>A CV 匹配度 · B 方向契合度 · C 薪资水平 · D 公司信号 · E 红旗项</span>
                <span>推荐级严格按 modes/_shared.md：4.5+ 强匹配；4.0–4.4 匹配良好；3.5–3.9 尚可；低于 3.5 不建议。</span>
              </div>
            </Card>

            <Card className="reports-detail-card" title="报告详情">
              {detailState === 'loading' ? <Skeleton active /> : null}
              {detailState === 'error' ? <Alert type="error" showIcon message="报告详情加载失败" /> : null}
              {detailState === 'ready' && detail ? (
                <>
                  <section className="reports-headcard">
                    <span className="reports-company-mark">{detail.company?.slice(0, 1)}</span>
                    <div className="reports-headcard__main">
                      <span>{detail.company ?? '—'}</span>
                      <h2>{detail.role ?? '—'}</h2>
                      <p>城市：{selectedApplication?.city ?? '—'} <b /> 薪资：{selectedApplication?.salary ?? '—'} <b /> 日期：{detail.date ?? '—'}</p>
                    </div>
                    <div className="reports-headcard__score">
                      <strong>{detail.score?.toFixed(1) ?? '—'} <small>/ 5</small></strong>
                      <Tag color={recommendationMeta.color}>{recommendationMeta.label}</Tag>
                    </div>
                  </section>

                  <div className="reports-section-tabs">
                    {SECTION_TABS.map((tab) => <button className={activeSection === tab.key ? 'is-active' : ''} key={tab.key} onClick={() => setActiveSection(tab.key)}>{tab.label}</button>)}
                  </div>

                  <section className="reports-detail-grid">
                    <div className="reports-panel">
                      <div className="reports-panel__title"><strong>{detail.scores ? 'A–E 五维雷达' : 'A–E 评估摘要'}</strong><ScoreTag score={detail.score ?? 0} /></div>
                      <SummaryVisual detail={detail} />
                    </div>
                    <div className="reports-panel reports-markdown">
                      <h3>{detail.sections?.[activeSection]?.title ?? SECTION_TABS.find((tab) => tab.key === activeSection)?.label}</h3>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.sections?.[activeSection]?.markdown ?? '暂无本章节内容。'}</ReactMarkdown>
                    </div>
                  </section>

                  <section className="reports-bottom-grid">
                    <div className="reports-panel">
                      <h3>相关资源</h3>
                      <a href={detail.url} target="_blank" rel="noreferrer"><span>职位原始链接</span><b>{detail.url ?? '未提供'}</b><LinkOutlined /></a>
                      {detail.reportPath ? <div><span>评估报告（MD）</span><b>{detail.reportPath}</b><FileMarkdownOutlined /></div> : <div><span>评估报告（MD）</span><b>未找到</b><FileMarkdownOutlined /></div>}
                      {selectedPdf ? <div><span>定制 PDF</span><b>{selectedPdf.filename}</b><FilePdfOutlined /></div> : <div><span>定制 PDF</span><b>未匹配到 cv-{detail.company}-{detail.date}.pdf</b><FilePdfOutlined /></div>}
                      <div><span>深度准备</span><b>{slug}-deep.md</b><FileMarkdownOutlined /></div>
                    </div>
                    <div className="reports-panel">
                      <h3>报告操作与对比</h3>
                      {aiTask.status.state === 'running' ? (
                        <div className="reports-running-task">
                          <p>AI 任务运行中：{aiTask.status.progress?.step ?? '处理中'}</p>
                          <Button danger size="small" onClick={() => void aiTask.cancel()}>取消</Button>
                        </div>
                      ) : (
                        <p>对当前报告执行重评估，或选择多份报告进行对比分析。</p>
                      )}
                      <div className="reports-disabled-actions">
                        <Button
                          disabled={!detail?.url || aiTask.status.state === 'running'}
                          loading={aiTask.status.state === 'running'}
                          onClick={() => { if (detail?.url) void aiTask.start('oferta', detail.url); }}
                        >重新评估</Button>
                        <Button disabled={!detail?.url || aiTask.status.state === 'running'} onClick={generatePdf}>生成 PDF</Button>
                        <Button disabled={!detail || !!selectedApplication} onClick={() => void addToTracker()}>{selectedApplication ? '已入库' : '入库 Tracker'}</Button>
                        <Button onClick={() => { setCompareMode(true); }}>多选对比</Button>
                      </div>
                    </div>
                  </section>
                </>
              ) : null}
            </Card>
          </div>
        </>
      )}
    </main>
  );
}
