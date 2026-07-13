import {
  CheckCircleFilled,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileZipOutlined,
  MinusCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Divider, Form, Input, message, Modal, Select, Skeleton, Space, Table, Tabs, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { EmptyState } from '../components/common';
import { useDataStore } from '../stores/dataStore';
import type {
  Application,
  EvaluationReportSummary,
  PdfFile,
} from '../types';
import './cv.css';

type LoadState = 'loading' | 'ready' | 'error';
type SyncState = 'checking' | 'ready' | 'unavailable';
type SyncIssue = { file: string; field: string; message: string; status: 'issue' | 'warning' };
type SyncResult = { total: number; passed: number; issues: number; warnings: number; details: SyncIssue[]; checkedAt?: string };
type PdfRow = PdfFile & { key: string; companyLabel: string; direction: string };
type MissingPdf = { key: string; company: string; direction: string };

const normalize = (value: string | null | undefined) => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const filenameStem = (value: string) => value.split('/').at(-1)?.replace(/\.pdf$/i, '').replace(/^cv-(?:candidate|sunzhijun|sunzj)-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '') ?? '';
const reportStem = (value: string | undefined) => value?.split('/').at(-1)?.replace(/\.md$/i, '').replace(/^\d+-/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '') ?? '';
const formatBytes = (size: number) => size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const formatDateTime = (value?: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '未知';


function matchesPdf(pdf: PdfFile, report: EvaluationReportSummary) {
  if (pdf.date && report.date && pdf.date !== report.date) return false;
  const pdfName = normalize(filenameStem(pdf.filename));
  const candidates = [report.company, reportStem(report.reportPath), report.pdfPath].map(normalize).filter(Boolean);
  return candidates.some((candidate) => candidate.length >= 3 && (pdfName.includes(candidate) || candidate.includes(pdfName)));
}

function extractJson(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  for (const candidate of [source, source.result, source.output, source.stdout]) {
    if (candidate && typeof candidate === 'object') return candidate as Record<string, unknown>;
    if (typeof candidate === 'string') {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
      } catch {
        // 非 JSON 输出表示当前端点还不能提供结构化检查结果。
      }
    }
  }
  return undefined;
}

function normalizeSyncResult(payload: unknown): SyncResult | undefined {
  const source = extractJson(payload);
  if (!source) return undefined;
  const toIssues = (value: unknown, status: SyncIssue['status']) => Array.isArray(value) ? value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    return [{
      file: String(row.file ?? '—'),
      field: String(row.field ?? '—'),
      message: String(row.message ?? '—'),
      status,
    }];
  }) : [];
  const issueRows = toIssues(source.errors ?? source.issues, 'issue');
  const warningRows = toIssues(source.warnings, 'warning');
  const passed = Number(source.passed ?? source.pass ?? 0) || 0;
  const total = Number(source.total ?? source.totalChecks ?? passed + issueRows.length + warningRows.length) || 0;
  return {
    total,
    passed,
    issues: Number(source.issueCount ?? source.errorCount ?? issueRows.length) || 0,
    warnings: Number(source.warningCount ?? warningRows.length) || 0,
    details: [...issueRows, ...warningRows],
    checkedAt: typeof source.checkedAt === 'string' ? source.checkedAt : new Date().toISOString(),
  };
}

export function CV() {
  const { loading: dataLoading, error: dataError, cvContent, reports, applications } = useDataStore();
  const loadState = dataLoading ? 'loading' as const : dataError ? 'error' as const : 'ready' as const;
  const [pdfFiles, setPdfFiles] = useState<PdfFile[]>([]);
  const [query, setQuery] = useState('');
  const [selectedPdf, setSelectedPdf] = useState<string>();
  const [syncState, setSyncState] = useState<SyncState>('checking');
  const [syncResult, setSyncResult] = useState<SyncResult>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [cvDraft, setCvDraft] = useState('');
  const [savingCv, setSavingCv] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState('');
  const [profileData, setProfileData] = useState<Record<string, unknown> | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileActiveTab, setProfileActiveTab] = useState('overview');
  const [previewUrl, setPreviewUrl] = useState<string>();
  const blobCache = useMemo(() => new Map<string, string>(), []);

  const getPdfBlobUrl = useCallback(async (filename: string) => {
    // 由后端只读静态服务提供（/api/files/output），任意浏览器可内联预览与下载。
    return `/api/files/output/${filename.split('/').map(encodeURIComponent).join('/')}`;
  }, []);

  useEffect(() => {
    if (!selectedPdf) { setPreviewUrl(undefined); return; }
    void getPdfBlobUrl(selectedPdf).then(setPreviewUrl);
  }, [selectedPdf, getPdfBlobUrl]);

  useEffect(() => {
    return () => { for (const url of blobCache.values()) URL.revokeObjectURL(url); };
  }, [blobCache]);

  const syncProfileToYaml = useCallback(async (data: Record<string, unknown>) => {
    try {
      const YAML = await import('yaml');
      setProfileDraft(YAML.stringify(data));
    } catch { /* ignore */ }
  }, []);

  const updateProfileField = useCallback((path: string[], value: unknown) => {
    setProfileData((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      let obj: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) {
        if (!obj[path[i]] || typeof obj[path[i]] !== 'object') obj[path[i]] = {};
        obj = obj[path[i]] as Record<string, unknown>;
      }
      obj[path[path.length - 1]] = value;
      void syncProfileToYaml(next);
      return next;
    });
  }, [syncProfileToYaml]);
  const [notice, noticeContext] = message.useMessage();

  const startBatchPdf = async () => {
    const response = await fetch('/api/scripts/batch-pdf-gen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (response.ok) void notice.success('批量 PDF 任务已启动');
    else void notice.error(response.status === 409 ? '批量 PDF 任务正在运行中' : '任务启动失败');
  };

  const downloadAllPdfs = () => {
    for (const [index, pdf] of filteredPdfRows.entries()) {
      window.setTimeout(async () => {
        const url = await getPdfBlobUrl(pdf.filename);
        if (!url) return;
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = pdf.filename.split('/').at(-1) ?? pdf.filename;
        anchor.click();
      }, index * 250);
    }
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch('/api/data/pdfs');
        if (res.ok && active) setPdfFiles(await res.json() as PdfFile[]);
      } catch { /* no pdfs */ }
    })();
    return () => { active = false; };
  }, [dataLoading]);

  const runSyncCheck = async () => {
    setSyncState('unavailable');
  };

  useEffect(() => { void runSyncCheck(); }, []);

  const openCvEditor = () => {
    setCvDraft(cvContent);
    setEditorOpen(true);
  };

  // 只读看板：cv.md / profile.yml 属于用户层文件，写入交给 Agent。
  const saveCv = () => {
    void notice.info('保存请对 Agent 说：把编辑后的内容写入 cv.md（可把草稿发给它）');
    setEditorOpen(false);
  };

  const openProfileEditor = async () => {
    try {
      const data = await fetch('/api/data/profile').then((r) => r.ok ? r.json() as Promise<Record<string, unknown>> : null);
      const YAML = await import('yaml');
      setProfileData(data);
      setProfileDraft(data ? YAML.stringify(data) : '');
      setProfileEditorOpen(true);
    } catch {
      void notice.error('profile.yml 加载失败');
    }
  };

  const saveProfile = () => {
    void notice.info('保存请对 Agent 说：把编辑后的内容写入 config/profile.yml');
    setProfileEditorOpen(false);
  };

  const applicationsByReport = useMemo(() => {
    const byPath = new Map<string, Application>();
    const byNumber = new Map<number, Application>();
    for (const application of applications) {
      if (application.reportPath) byPath.set(application.reportPath, application);
      const num = Number(application.reportNumber);
      if (Number.isFinite(num)) byNumber.set(num, application);
    }
    return { byNumber, byPath };
  }, [applications]);

  const pdfRows = useMemo<PdfRow[]>(() => pdfFiles.map((pdf) => {
    const report = reports.find((item) => matchesPdf(pdf, item));
    const application = report
      ? applicationsByReport.byPath.get(report.reportPath ?? '') ?? (report.num === undefined ? undefined : applicationsByReport.byNumber.get(report.num))
      : applications.find((item) => item.date === pdf.date && normalize(pdf.filename).includes(normalize(item.company)));
    return {
      ...pdf,
      key: pdf.filename,
      companyLabel: application?.company ?? report?.company ?? pdf.company ?? filenameStem(pdf.filename) ?? '未知公司',
      direction: application?.direction ?? report?.direction ?? application?.role ?? report?.role ?? '未关联',
    };
  }).sort((a, b) => String(b.date ?? b.mtime).localeCompare(String(a.date ?? a.mtime))), [applications, applicationsByReport, pdfFiles, reports]);

  const filteredPdfRows = useMemo(() => {
    const keyword = normalize(query);
    return keyword ? pdfRows.filter((row) => normalize(`${row.companyLabel}${row.direction}${row.filename}`).includes(keyword)) : pdfRows;
  }, [pdfRows, query]);

  const missingPdfs = useMemo<MissingPdf[]>(() => reports.flatMap((report) => {
    if (pdfFiles.some((pdf) => matchesPdf(pdf, report))) return [];
    const application = applicationsByReport.byPath.get(report.reportPath ?? '') ?? (report.num === undefined ? undefined : applicationsByReport.byNumber.get(report.num));
    return [{
      key: report.reportPath ?? String(report.num),
      company: report.company ?? application?.company ?? '未知公司',
      direction: report.direction ?? application?.direction ?? report.role ?? application?.role ?? '未关联',
    }];
  }), [applicationsByReport, pdfFiles, reports]);

  const pdfColumns: ColumnsType<PdfRow> = [
    {
      title: '公司',
      dataIndex: 'companyLabel',
      render: (value: string) => <span className="cv-company"><b>{value.slice(0, 1)}</b><strong>{value}</strong></span>,
    },
    { title: '岗位方向', dataIndex: 'direction' },
    { title: '生成日期 ↓', render: (_, row) => row.date ?? formatDateTime(row.mtime) },
    { title: '文件大小', dataIndex: 'size', render: formatBytes },
    { title: '预览', render: () => <span className="cv-pdf-thumb" /> },
    {
      title: '操作',
      width: 64,
      render: (_, row) => (
        <Tooltip title="下载 PDF">
          <Button type="text" icon={<DownloadOutlined />} onClick={async (event) => { event.stopPropagation(); const url = await getPdfBlobUrl(row.filename); if (url) { const a = document.createElement('a'); a.href = url; a.download = row.filename.split('/').at(-1) ?? row.filename; a.click(); } }} />
        </Tooltip>
      ),
    },
  ];

  const syncColumns: ColumnsType<SyncIssue> = [
    { title: '文件', dataIndex: 'file', width: 130 },
    { title: '字段', dataIndex: 'field', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 74,
      render: (status: SyncIssue['status']) => <Tag color={status === 'issue' ? 'error' : 'warning'}>{status === 'issue' ? '问题' : '警告'}</Tag>,
    },
    { title: '说明', dataIndex: 'message' },
  ];

  if (loadState === 'loading') {
    return <main className="app-page cv-page"><Skeleton active /><div className="cv-top">{Array.from({ length: 3 }, (_, index) => <Card key={index}><Skeleton active /></Card>)}</div><div className="cv-bottom">{Array.from({ length: 2 }, (_, index) => <Card key={index}><Skeleton active /></Card>)}</div></main>;
  }

  return (
    <main className="app-page cv-page">
      {noticeContext}
      <div className="cv-head"><div><h1>简历管理</h1><p>管理基础简历与定制化版本，确保内容一致且针对性匹配</p></div></div>
      {loadState === 'error' ? <Alert type="error" showIcon message="简历管理数据加载失败" description="请确认 Web API 服务已启动后刷新页面。" /> : null}

      <div className="cv-top">
        <Card title="基础简历（cv.md）" extra="本地文件">
          <div className="cv-actions">
            <Button icon={<EditOutlined />} onClick={openCvEditor}>编辑 cv.md</Button>
            <Button icon={<SettingOutlined />} onClick={() => void openProfileEditor()}>编辑 profile.yml</Button>
            <Tooltip title={syncState === 'unavailable' ? '检查端点尚未就绪' : undefined}><span><Button type="primary" disabled={syncState === 'unavailable'} loading={syncState === 'checking'} icon={<PlayCircleOutlined />} onClick={() => void runSyncCheck()}>运行一致性检查</Button></span></Tooltip>
          </div>
          <h3 className="cv-subtitle">简历模板</h3>
          <div className="cv-template">
            <div className="cv-template__head"><span className="cv-template__icon"><FileTextOutlined /></span><div><strong>现代简约 · ATS 优化版</strong><div><Tag>单页</Tag><Tag>技术岗通用</Tag><Tag>ATS 优化</Tag></div></div></div>
            <p>模板路径：templates/cv-template.html<br />当前固定模板，不支持更换</p>
          </div>
        </Card>

        <Card title="简历预览" extra="cv.md · 只读">
          {cvContent ? <div className="cv-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cvContent}</ReactMarkdown></div> : <EmptyState title="暂无简历内容" description="cv.md 当前为空。" />}
        </Card>

        <Card title="简历一致性检查结果" extra={syncState === 'ready' ? `检查时间：${formatDateTime(syncResult?.checkedAt)}` : '未检测'}>
          {syncState === 'checking' ? <Skeleton active /> : syncState === 'unavailable' ? (
            <EmptyState title="未检测" description="一致性检查端点尚未就绪。" action={<Tooltip title="检查端点尚未就绪"><span><Button disabled icon={<ReloadOutlined />}>手动运行</Button></span></Tooltip>} />
          ) : (
            <>
              <div className="cv-check-grid">
                <div><span>总检查项</span><strong>{syncResult?.total ?? 0}</strong></div>
                <div className="is-pass"><span>通过</span><strong>{syncResult?.passed ?? 0}</strong></div>
                <div className="is-issue"><span>问题</span><strong>{syncResult?.issues ?? 0}</strong></div>
                <div className="is-warning"><span>警告</span><strong>{syncResult?.warnings ?? 0}</strong></div>
              </div>
              {syncResult?.details.length ? <Table rowKey={(row) => `${row.status}-${row.file}-${row.field}-${row.message}`} size="small" columns={syncColumns} dataSource={syncResult.details} pagination={false} scroll={{ y: 250 }} /> : <EmptyState icon={<CheckCircleFilled />} title="全部检查通过" description="未发现问题或警告。" />}
            </>
          )}
        </Card>
      </div>

      <div className="cv-bottom">
        <Card title="定制化 PDF 列表" extra={`${pdfRows.length} 份 · output/`}>
          <div className="cv-toolbar">
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索公司名称" value={query} onChange={(event) => setQuery(event.target.value)} />
            <Button disabled={!filteredPdfRows.length} icon={<FileZipOutlined />} onClick={downloadAllPdfs}>批量下载</Button>
            <Button type="primary" disabled={!missingPdfs.length} icon={<FilePdfOutlined />} onClick={() => void startBatchPdf()}>补全缺失 PDF</Button>
          </div>
          {filteredPdfRows.length ? (
            <Table
              className="cv-pdf-table"
              rowKey="key"
              columns={pdfColumns}
              dataSource={filteredPdfRows}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              expandable={{
                expandedRowKeys: selectedPdf ? [selectedPdf] : [],
                showExpandColumn: false,
                expandedRowRender: (row) => (
                  <div className="cv-pdf-viewer">
                    <div>
                      <span>PDF 原生预览</span>
                      <Button type="text" size="small" onClick={() => setSelectedPdf(undefined)}>收起</Button>
                    </div>
                    <iframe title={`PDF 预览：${row.filename}`} src={previewUrl ?? ''} />
                  </div>
                ),
              }}
              onRow={(row) => ({ onClick: () => setSelectedPdf((current) => current === row.filename ? undefined : row.filename), className: selectedPdf === row.filename ? 'cv-row--selected' : '' })}
            />
          ) : <EmptyState title={query ? '没有匹配的 PDF' : '暂无定制 PDF'} description={query ? '请尝试其他公司名称。' : 'output/ 目录中还没有 PDF 文件。'} />}
        </Card>

        <Card title="补全缺失 PDF" extra={`${missingPdfs.length} 项`}>
          <p className="cv-muted">基于 reports/ 与 output/ 的前端差集，发现以下待生成项</p>
          {missingPdfs.length ? <Table rowKey="key" size="small" pagination={{ pageSize: 8, hideOnSinglePage: true }} dataSource={missingPdfs} columns={[
            { title: '公司', dataIndex: 'company', render: (value: string) => <strong>{value}</strong> },
            { title: '岗位方向', dataIndex: 'direction' },
            { title: '状态', render: () => <Tag color="processing">待生成</Tag> },
          ]} /> : <EmptyState icon={<CheckCircleFilled />} title="PDF 已齐全" description="没有发现有报告但缺少 PDF 的项目。" />}
          <Button className="cv-generate" type="primary" size="large" disabled={!missingPdfs.length} icon={<PlayCircleOutlined />} onClick={() => void startBatchPdf()}>开始生成（{missingPdfs.length} 项）</Button>
        </Card>
      </div>

      <Modal
        title="编辑基础简历（cv.md）"
        open={editorOpen}
        width={900}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingCv}
        onCancel={() => setEditorOpen(false)}
        onOk={saveCv}
      >
        <Alert type="warning" showIcon message="这是用户层文件" description="保存时会检查文件最后修改时间；如果命令行刚修改过，系统会拒绝覆盖。" />
        <Input.TextArea className="cv-editor" value={cvDraft} onChange={(event) => setCvDraft(event.target.value)} autoSize={{ minRows: 20, maxRows: 30 }} />
      </Modal>

      <Modal
        title="编辑个人配置（profile.yml）"
        open={profileEditorOpen}
        width={960}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingProfile}
        onCancel={() => setProfileEditorOpen(false)}
        onOk={saveProfile}
      >
        <Tabs activeKey={profileActiveTab} onChange={(key) => {
          if (key === 'yaml' && profileData) { void syncProfileToYaml(profileData); }
          if (key === 'overview' && profileActiveTab === 'yaml') {
            try {
              import('yaml').then((YAML) => { setProfileData(YAML.parse(profileDraft) as Record<string, unknown>); }).catch(() => {});
            } catch { /* ignore */ }
          }
          setProfileActiveTab(key);
        }} items={[
          { key: 'overview', label: '可视化编辑', children: profileData ? (() => {
            const candidate = (profileData.candidate ?? {}) as Record<string, string>;
            const targetRoles = (profileData.target_roles ?? {}) as Record<string, unknown>;
            const compensation = (profileData.compensation ?? {}) as Record<string, string>;
            const search = (profileData.search_strategy ?? {}) as Record<string, unknown>;
            const narrative = (profileData.narrative ?? {}) as Record<string, unknown>;
            return (
              <div className="cv-profile-overview" style={{ maxHeight: 560, overflowY: 'auto', padding: '0 4px' }}>
                <Divider orientation="left" style={{ margin: '4px 0 12px' }}>基本信息</Divider>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                  <Form.Item label="姓名" style={{ marginBottom: 8 }}>
                    <Input value={candidate.full_name ?? ''} onChange={(e) => updateProfileField(['candidate', 'full_name'], e.target.value)} />
                  </Form.Item>
                  <Form.Item label="邮箱" style={{ marginBottom: 8 }}>
                    <Input value={candidate.email ?? ''} onChange={(e) => updateProfileField(['candidate', 'email'], e.target.value)} />
                  </Form.Item>
                  <Form.Item label="电话" style={{ marginBottom: 8 }}>
                    <Input value={candidate.phone ?? ''} onChange={(e) => updateProfileField(['candidate', 'phone'], e.target.value)} />
                  </Form.Item>
                  <Form.Item label="位置" style={{ marginBottom: 8 }}>
                    <Input value={candidate.location ?? ''} onChange={(e) => updateProfileField(['candidate', 'location'], e.target.value)} />
                  </Form.Item>
                </div>

                <Divider orientation="left" style={{ margin: '8px 0 12px' }}>目标岗位</Divider>
                <Form.Item label="主要方向" style={{ marginBottom: 8 }}>
                  <Select mode="tags" value={(targetRoles.primary ?? []) as string[]} onChange={(v) => updateProfileField(['target_roles', 'primary'], v)} placeholder="输入后回车添加" tokenSeparators={[',']} />
                </Form.Item>
                <Form.Item label="次要方向" style={{ marginBottom: 8 }}>
                  <Select mode="tags" value={(targetRoles.secondary ?? []) as string[]} onChange={(v) => updateProfileField(['target_roles', 'secondary'], v)} placeholder="输入后回车添加" tokenSeparators={[',']} />
                </Form.Item>

                <Divider orientation="left" style={{ margin: '8px 0 12px' }}>薪酬</Divider>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                  <Form.Item label="目标范围" style={{ marginBottom: 8 }}>
                    <Input value={compensation.target_range ?? ''} onChange={(e) => updateProfileField(['compensation', 'target_range'], e.target.value)} />
                  </Form.Item>
                  <Form.Item label="最低底线" style={{ marginBottom: 8 }}>
                    <Input value={compensation.minimum ?? ''} onChange={(e) => updateProfileField(['compensation', 'minimum'], e.target.value)} />
                  </Form.Item>
                </div>

                <Divider orientation="left" style={{ margin: '8px 0 12px' }}>叙事定位</Divider>
                <Form.Item label="标题" style={{ marginBottom: 8 }}>
                  <Input.TextArea value={(narrative.headline as string) ?? ''} onChange={(e) => updateProfileField(['narrative', 'headline'], e.target.value)} autoSize={{ minRows: 1, maxRows: 3 }} />
                </Form.Item>

                <Divider orientation="left" style={{ margin: '8px 0 12px' }}>搜索策略</Divider>
                <Form.Item label="主关键词" style={{ marginBottom: 8 }}>
                  <Select mode="tags" value={((search.primary_keywords ?? []) as string[])} onChange={(v) => updateProfileField(['search_strategy', 'primary_keywords'], v)} placeholder="输入后回车添加" tokenSeparators={[',']} />
                </Form.Item>
                <Form.Item label="偏好城市" style={{ marginBottom: 8 }}>
                  <Select mode="tags" value={((search.preferred_cities ?? []) as string[])} onChange={(v) => updateProfileField(['search_strategy', 'preferred_cities'], v)} placeholder="输入后回车添加" tokenSeparators={[',']} />
                </Form.Item>
                <Form.Item label="排除词" style={{ marginBottom: 8 }}>
                  <Select mode="tags" value={(((search.filters as Record<string, unknown>)?.exclude_keywords ?? []) as string[])} onChange={(v) => updateProfileField(['search_strategy', 'filters', 'exclude_keywords'], v)} placeholder="输入后回车添加" tokenSeparators={[',']} />
                </Form.Item>
              </div>
            );
          })() : <Skeleton active /> },
          { key: 'yaml', label: 'YAML 编辑', children: (
            <>
              <Alert type="warning" showIcon message="这是用户层文件" description="保存时会检查文件最后修改时间；如果命令行刚修改过，系统会拒绝覆盖。YAML 格式错误会导致保存失败。" />
              <Input.TextArea className="cv-editor" value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} autoSize={{ minRows: 20, maxRows: 30 }} />
            </>
          ) },
        ]} />
      </Modal>
    </main>
  );
}
