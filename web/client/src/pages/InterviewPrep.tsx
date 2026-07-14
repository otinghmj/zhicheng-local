import {
  EditOutlined,
  FileSearchOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, message, Modal, Select, Skeleton, Tag } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useSearchParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

import { EmptyState, ScoreTag, TriStateBadge } from '../components/common';
import type { TriState } from '../components/common';
import { useAiTask } from '../hooks/useAiTask';
import { useDataStore } from '../stores/dataStore';
import type { Application, InterviewPrepFile, StoryBankStory, StoryBankStoryCreate } from '../types';
import './interview-prep.css';

type LoadState = 'loading' | 'ready' | 'error';
type DetailState = 'idle' | 'loading' | 'ready' | 'error';
type ModuleKey = 'immersion' | 'glossary' | 'simulate' | 'roleplay' | 'portfolio';
type MarkdownSection = { title: string; markdown: string };

const MODULES: Array<{ key: ModuleKey; title: string; description: string; heading: RegExp }> = [
  { key: 'immersion', title: '行业沉浸', description: '理解行业场景、工作流、协作对象与工具栈', heading: /模块\s*1|行业沉浸/ },
  { key: 'glossary', title: '名词解释', description: '梳理岗位术语、用途、接话思路与易错点', heading: /模块\s*2|名词解释|术语/ },
  { key: 'simulate', title: '任务模拟', description: '拆解典型任务并按步骤完成实战演练', heading: /任务模拟/ },
  { key: 'roleplay', title: '角色扮演', description: '模拟领导、同事与客户的真实追问', heading: /角色扮演/ },
  { key: 'portfolio', title: '小作品框架', description: '输出贴合岗位的小作品规格与实现思路', heading: /模块\s*5|小作品|作品框架/ },
];

const tagColors = ['processing', 'success', 'warning', 'purple', 'cyan', 'magenta'] as const;
const normalize = (value: string | null | undefined) => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const tokens = (value: string | null | undefined) => String(value ?? '')
  .toLocaleLowerCase()
  .replace(/\.md$|^-?\d+-|-\d{4}-\d{2}-\d{2}$|-deep$/g, '')
  .split(/[^\p{L}\p{N}]+/u)
  .filter((item) => item.length > 1 && !['engineer', 'engineering'].includes(item));

function prepMatchScore(application: Application, file: InterviewPrepFile) {
  if (!file.slug.endsWith('-deep')) return -1;
  const candidate = new Set(tokens(file.slug));
  const source = [
    ...tokens(application.reportPath?.split('/').at(-1)),
    ...tokens(application.company),
    ...tokens(application.role),
  ];
  let score = source.reduce((total, token) => total + (candidate.has(token) ? 2 : 0), 0);
  const company = normalize(application.company);
  const slug = normalize(file.slug);
  if (company.length > 2 && (slug.includes(company) || company.includes(slug.replace(/deep$/, '')))) score += 5;
  return score;
}

function findPrepFile(application: Application | undefined, files: InterviewPrepFile[]) {
  if (!application) return undefined;
  return files
    .map((file) => ({ file, score: prepMatchScore(application, file) }))
    .filter(({ score }) => score >= 4)
    .sort((a, b) => b.score - a.score)[0]?.file;
}

function parseH2Modules(markdown: string) {
  const parts = markdown.split(/(?=^##\s+)/m);
  return parts.flatMap((part) => {
    const title = part.match(/^##\s+(.+)$/m)?.[1]?.trim();
    return title ? [{ title, markdown: part.trim() }] : [];
  });
}

function parseH3Sections(markdown: string): MarkdownSection[] {
  const parts = markdown.split(/(?=^###\s+)/m);
  const intro = parts.shift()?.replace(/^##\s+.+$/m, '').trim();
  const sections = parts.flatMap((part) => {
    const title = part.match(/^###\s+(.+)$/m)?.[1]?.trim();
    return title ? [{ title, markdown: part.trim() }] : [];
  });
  return sections.length ? sections : [{ title: '内容', markdown: intro || markdown }];
}

function truncate(value: string, length = 92) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function InterviewPrep() {
  const navigate = useNavigate();
  const [storyForm] = Form.useForm<StoryBankStoryCreate & { themesText: string; suitableForText: string }>();
  const [editForm] = Form.useForm();
  const [notice, noticeContext] = message.useMessage();
  const [searchParams] = useSearchParams();
  const { loading: dataLoading, error: dataError, applications: allApplications, storyBank, reloadStoryBank } = useDataStore();
  const loadState = dataLoading ? 'loading' as const : dataError ? 'error' as const : 'ready' as const;
  const [detailState, setDetailState] = useState<DetailState>('idle');
  const [prepFiles, setPrepFiles] = useState<InterviewPrepFile[]>([]);
  const [selectedApplicationNum, setSelectedApplicationNum] = useState<number>();
  const [selectedStoryId, setSelectedStoryId] = useState<string>();
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState('all');
  const [activeModule, setActiveModule] = useState<ModuleKey>('immersion');
  const [activeSection, setActiveSection] = useState('');
  const [prepMarkdown, setPrepMarkdown] = useState('');
  const [storyModalOpen, setStoryModalOpen] = useState(false);
  const [savingStory, setSavingStory] = useState(false);
  const [editingStory, setEditingStory] = useState<StoryBankStory | null>(null);
  const [editStoryModalOpen, setEditStoryModalOpen] = useState(false);
  const [savingEditStory, setSavingEditStory] = useState(false);

  const aiTask = useAiTask();
  const stories = storyBank;

  const applications = useMemo(() =>
    allApplications
      .filter((item) => (item.score ?? 0) >= 4 || item.status === 'Interview')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.num - a.num),
    [allApplications],
  );

  useEffect(() => {
    if (aiTask.status.state === 'completed') {
      void reloadStoryBank();
      void notice.success('面试准备模块生成完成');
    }
    if (aiTask.status.state === 'failed') {
      void notice.error(aiTask.status.error ?? '面试准备生成失败');
    }
  }, [aiTask.status.state, aiTask.status.error, notice, reloadStoryBank]);

  useEffect(() => {
    if (dataLoading) return;
    void (async () => {
      try {
        const res = await fetch('/api/data/interview-prep');
        const files = res.ok ? await res.json() as InterviewPrepFile[] : [];
        const deepFiles = files.filter((f) => f.slug.endsWith('-deep') && f.filename !== 'story-bank.md');
        setPrepFiles(deepFiles);
        const requested = Number(searchParams.get('application'));
        const requestedApp = applications.find((item) => item.num === requested);
        const defaultApp = requestedApp
          ?? applications.find((item) => findPrepFile(item, deepFiles))
          ?? applications[0];
        setSelectedApplicationNum(defaultApp?.num);
      } catch { /* no interview-prep data */ }
    })();
  }, [dataLoading, searchParams, applications]);

  const selectedApplication = applications.find((item) => item.num === selectedApplicationNum);
  const selectedPrepFile = useMemo(() => findPrepFile(selectedApplication, prepFiles), [prepFiles, selectedApplication]);

  useEffect(() => {
    if (!selectedPrepFile) {
      setPrepMarkdown('');
      setDetailState('idle');
      setActiveModule('immersion');
      return;
    }
    let active = true;
    setDetailState('loading');
    void fetch(`/api/data/interview-prep/${encodeURIComponent(selectedPrepFile.slug)}`)
      .then((res) => res.ok ? res.text() : Promise.reject(new Error('not found')))
      .then((markdown) => {
        if (!active) return;
        setPrepMarkdown(markdown);
        setDetailState('ready');
        const firstCompleted = MODULES.find((module) => parseH2Modules(markdown).some((section) => module.heading.test(section.title)));
        setActiveModule(firstCompleted?.key ?? 'immersion');
      })
      .catch(() => active && setDetailState('error'));
    return () => { active = false; };
  }, [selectedPrepFile]);

  const moduleSections = useMemo(() => parseH2Modules(prepMarkdown), [prepMarkdown]);
  const moduleStates = useMemo(() => {
    const runningMode = aiTask.status.state === 'running' ? aiTask.status.jobId : null;
    const modeMap: Record<string, ModuleKey> = {
      'deep-prep-immersion': 'immersion',
      'deep-prep-glossary': 'glossary',
      'deep-prep-simulate': 'simulate',
      'deep-prep-roleplay': 'roleplay',
      'deep-prep-portfolio': 'portfolio',
    };
    return Object.fromEntries(MODULES.map((module) => {
      const hasContent = moduleSections.some((section) => module.heading.test(section.title));
      if (hasContent) return [module.key, 'completed'];
      if (runningMode && aiTask.status.progress?.step) return [module.key, 'not-started'];
      return [module.key, 'not-started'];
    })) as Record<ModuleKey, TriState>;
  }, [moduleSections, aiTask.status.state, aiTask.status.jobId, aiTask.status.progress?.step]);
  const activeModuleMarkdown = moduleSections.find((section) => MODULES.find((module) => module.key === activeModule)?.heading.test(section.title))?.markdown ?? '';
  const detailSections = useMemo(() => activeModuleMarkdown ? parseH3Sections(activeModuleMarkdown) : [], [activeModuleMarkdown]);

  useEffect(() => {
    setActiveSection(detailSections[0]?.title ?? '');
  }, [activeModule, detailSections]);

  const themeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    stories.forEach((story) => story.themes.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [stories]);
  const filteredStories = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return stories.filter((story) => {
      if (theme !== 'all' && !story.themes.includes(theme)) return false;
      return !keyword || `${story.title} ${story.situation} ${story.suitableFor.join(' ')}`.toLocaleLowerCase().includes(keyword);
    });
  }, [query, stories, theme]);

  if (loadState === 'loading') {
    return <main className="app-page prep-page"><Skeleton active /><div className="prep-layout"><Card><Skeleton active /></Card><Card><Skeleton active /></Card></div></main>;
  }

  const activeDetail = detailSections.find((section) => section.title === activeSection);
  const activeModuleMeta = MODULES.find((module) => module.key === activeModule)!;

  // 只读看板：故事库写操作交给 Agent。校验后提示如何交给 Agent。
  const createStory = async () => {
    const value = await storyForm.validateFields();
    void notice.info(`新增故事请对 Agent 说：把「${value.title}」按 STAR+R 追加到 interview-prep/story-bank.md`);
    setStoryModalOpen(false);
    storyForm.resetFields();
  };

  const openEditStory = (story: StoryBankStory) => {
    setEditingStory(story);
    editForm.setFieldsValue({
      title: story.title,
      themesText: story.themes.join('、'),
      source: story.source ?? '',
      situation: story.situation,
      task: story.task,
      action: story.action,
      result: story.result,
      reflection: story.reflection,
      suitableForText: story.suitableFor.join('、'),
    });
    setEditStoryModalOpen(true);
  };

  const saveEditStory = async () => {
    if (!editingStory) return;
    const value = await editForm.validateFields();
    void notice.info(`更新故事请对 Agent 说：把 interview-prep/story-bank.md 里的「${editingStory.title}」更新为「${value.title}」`);
    setEditStoryModalOpen(false);
  };

  return (
    <main className="app-page prep-page">
      {noticeContext}
      {loadState === 'error' ? <Alert type="error" showIcon message="面试准备数据加载失败" description="请确认 Web API 服务已启动后刷新页面。" /> : null}

      <section className="prep-selectbar">
        <div className="prep-head"><h1>面试准备</h1><p>深度准备每一次面试，从故事到实战全面提升</p></div>
        <div className="prep-picker">
          <span>岗位选择器</span>
          <Select
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="选择高分或进入面试的岗位"
            value={selectedApplicationNum}
            onChange={setSelectedApplicationNum}
            options={applications.map((application) => ({
              value: application.num,
              label: `${application.company} · ${application.role} · 评分 ${application.score ?? '—'}`,
            }))}
          />
        </div>
        <div className="prep-meta">
          <div><span>评估日期</span><strong>{selectedApplication?.date ?? '—'}</strong></div>
          <div><span>综合评分</span><strong>{typeof selectedApplication?.score === 'number' ? <ScoreTag score={selectedApplication.score} /> : '—'}</strong></div>
          <div><span>方向标签</span><strong><Tag color="processing">{selectedApplication?.direction ?? '未归类'}</Tag></strong></div>
        </div>
        <Button icon={<FileSearchOutlined />} disabled={!selectedApplication} onClick={() => navigate('/reports')}>打开评估报告</Button>
      </section>

      <div className="prep-layout">
        <Card
          className="prep-story-panel"
          title="STAR+R 故事库"
          extra={<span>共 {stories.length} 条故事</span>}
        >
          <div className="prep-story-tools">
            <Input allowClear prefix={<SearchOutlined />} placeholder="搜索标题 / 内容关键词" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="prep-theme-filter">
            <span>能力标签</span>
            <Select value={theme} onChange={setTheme} options={[{ value: 'all', label: `全部能力 ${stories.length}` }, ...themeCounts.map(([value, count]) => ({ value, label: `${value} ${count}` }))]} />
          </div>
          <div className="prep-theme-tabs">
            {themeCounts.map(([item, count]) => <button className={theme === item ? 'is-active' : ''} key={item} onClick={() => setTheme(theme === item ? 'all' : item)}>{item}<b>{count}</b></button>)}
          </div>
          <div className="prep-story-list">
            {filteredStories.length ? filteredStories.map((story) => (
              <article
                className={`prep-story ${selectedStoryId === story.id ? 'is-active' : ''}`}
                key={story.id}
                onClick={() => setSelectedStoryId(selectedStoryId === story.id ? undefined : story.id)}
              >
                <div>{story.themes.map((item, index) => <Tag color={tagColors[index % tagColors.length]} key={item}>{item}</Tag>)}</div>
                <h3>{story.title}</h3>
                <p className="prep-story__suitable">适用于：{story.suitableFor.join(' · ')}</p>
                <p className="prep-story__summary"><span>{truncate(story.situation)}</span></p>
                <span className="prep-story__toggle">{selectedStoryId === story.id ? '收起完整故事' : '查看完整 STAR+R'}</span>
                {selectedStoryId === story.id ? (
                  <div className="prep-story__detail">
                    {[
                      ['S · 情境', story.situation],
                      ['T · 任务', story.task],
                      ['A · 行动', story.action],
                      ['R · 结果', story.result],
                      ['复盘', story.reflection],
                    ].map(([label, content]) => content ? (
                      <section key={label}>
                        <strong>{label}</strong>
                        <p>{content}</p>
                      </section>
                    ) : null)}
                    {story.source ? <p className="prep-story__source">来源：{story.source}</p> : null}
                  </div>
                ) : null}
              </article>
            )) : <EmptyState title="没有匹配的故事" description="请调整搜索关键词或能力标签。" />}
          </div>
        </Card>

        <div className="prep-main">
          <Card
            className="prep-module-panel"
            title="深度准备状态"
            extra={<span>5 个模块</span>}
          >
            <div className="prep-module-grid">
              {MODULES.map((module, index) => {
                const state = moduleStates[module.key];
                return (
                  <button className={`prep-module ${activeModule === module.key ? 'is-active' : ''} is-${state}`} key={module.key} onClick={() => setActiveModule(module.key)}>
                    <span className="prep-module__number">{index + 1}</span>
                    <strong>{module.title}</strong>
                    <TriStateBadge state={state} />
                    <p>{state === 'completed' && selectedPrepFile?.mtime ? `完成时间：${dayjs(selectedPrepFile.mtime).format('YYYY-MM-DD HH:mm')}\n` : ''}{module.description}</p>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card
            className="prep-detail-panel"
            title={`${String(MODULES.findIndex((module) => module.key === activeModule) + 1).padStart(2, '0')} ${activeModuleMeta.title}`}
            extra={<TriStateBadge state={aiTask.status.state === 'running' ? 'generating' : moduleStates[activeModule]} />}
          >
            {detailState === 'loading' ? <Skeleton active /> : detailState === 'error' ? (
              <Alert type="error" showIcon message="深度准备文件读取失败" />
            ) : activeModuleMarkdown ? (
              <>
                <div className="prep-detail-tabs">{detailSections.map((section) => <button className={section.title === activeSection ? 'is-active' : ''} key={section.title} onClick={() => setActiveSection(section.title)}>{section.title}</button>)}</div>
                <div className="prep-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{activeDetail?.markdown ?? activeModuleMarkdown}</ReactMarkdown></div>
                <div className="prep-detail-time">最后更新：{selectedPrepFile?.mtime ? dayjs(selectedPrepFile.mtime).format('YYYY-MM-DD HH:mm') : '未知'}</div>
              </>
            ) : (
              <EmptyState title={`${activeModuleMeta.title}尚未开始`} description={selectedPrepFile ? '当前深度准备文件中还没有此模块。' : '当前岗位还没有匹配的深度准备文件。请通过 AI Agent 生成后再查看。'} />
            )}
          </Card>
        </div>
      </div>

      <Modal
        title="新增 STAR+R 故事"
        open={storyModalOpen}
        width={760}
        okText="追加到故事库"
        cancelText="取消"
        confirmLoading={savingStory}
        onCancel={() => setStoryModalOpen(false)}
        onOk={() => void createStory()}
      >
        <Alert type="info" showIcon message="保存后会以人类可读格式追加到 interview-prep/story-bank.md 文件尾。" />
        <Form className="prep-story-form" form={storyForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写故事标题' }]}><Input /></Form.Item>
          <Form.Item name="themesText" label="标签" extra="多个标签用逗号分隔，例如：独立交付，从0到1" rules={[{ required: true, message: '请至少填写一个标签' }]}><Input /></Form.Item>
          <Form.Item name="source" label="来源" rules={[{ required: true, message: '请填写故事来源' }]}><Input /></Form.Item>
          {[
            ['situation', 'S · 情境'],
            ['task', 'T · 任务'],
            ['action', 'A · 行动'],
            ['result', 'R · 结果'],
            ['reflection', '复盘'],
          ].map(([name, label]) => <Form.Item name={name} label={label} rules={[{ required: true, message: `请填写${label}` }]} key={name}><Input.TextArea rows={3} /></Form.Item>)}
          <Form.Item name="suitableForText" label="适用于" extra="多个场景用逗号分隔" rules={[{ required: true, message: '请至少填写一个适用场景' }]}><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑故事"
        open={editStoryModalOpen}
        width={760}
        okText="保存修改"
        cancelText="取消"
        confirmLoading={savingEditStory}
        onCancel={() => setEditStoryModalOpen(false)}
        onOk={() => void saveEditStory()}
      >
        <Form className="prep-story-form" form={editForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写故事标题' }]}><Input /></Form.Item>
          <Form.Item name="themesText" label="标签" extra="多个标签用逗号分隔" rules={[{ required: true, message: '请至少填写一个标签' }]}><Input /></Form.Item>
          <Form.Item name="source" label="来源" rules={[{ required: true, message: '请填写故事来源' }]}><Input /></Form.Item>
          {[
            ['situation', 'S · 情境'],
            ['task', 'T · 任务'],
            ['action', 'A · 行动'],
            ['result', 'R · 结果'],
            ['reflection', '复盘'],
          ].map(([name, label]) => <Form.Item name={name} label={label} rules={[{ required: true, message: `请填写${label}` }]} key={name}><Input.TextArea rows={3} /></Form.Item>)}
          <Form.Item name="suitableForText" label="适用于" extra="多个场景用逗号分隔" rules={[{ required: true, message: '请至少填写一个适用场景' }]}><Input /></Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
