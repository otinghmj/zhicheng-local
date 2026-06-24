import {
  CheckOutlined,
  DownloadOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Card, Progress, Space, Statistic, Table, Tabs, Tag } from 'antd';
import type { TableColumnsType } from 'antd';

import {
  EmptyState,
  PlatformChip,
  ScoreTag,
  StatCard,
  StatStrip,
  StatusBadge,
  TriStateBadge,
} from '../components/common';
import type { StateDefinition } from '../types';
import './theme-check.css';

type Task = {
  key: string;
  platform: string;
  mark: string;
  markClass: string;
  keywords: string;
  city: string;
  status: '已完成' | '运行中' | '运行失败';
  progress: number;
  discovered: number;
};

const tasks: Task[] = [
  {
    key: 'boss',
    platform: 'BOSS直聘',
    mark: 'B',
    markClass: 'theme-check__platform--boss',
    keywords: '后端开发, Java, Spring',
    city: '上海',
    status: '已完成',
    progress: 100,
    discovered: 128,
  },
  {
    key: 'liepin',
    platform: '猎聘 API',
    mark: '猎',
    markClass: 'theme-check__platform--liepin',
    keywords: '数据分析师, BI, SQL',
    city: '杭州',
    status: '运行中',
    progress: 52,
    discovered: 56,
  },
  {
    key: 'zhaopin',
    platform: '智联 RPA',
    mark: '智',
    markClass: 'theme-check__platform--zhaopin',
    keywords: '运维工程师, DevOps',
    city: '广州',
    status: '运行失败',
    progress: 34,
    discovered: 22,
  },
];

const statusClass = {
  已完成: 'theme-check__tag--success',
  运行中: 'theme-check__tag--primary',
  运行失败: 'theme-check__tag--danger',
} satisfies Record<Task['status'], string>;

const columns: TableColumnsType<Task> = [
  {
    title: '平台',
    dataIndex: 'platform',
    render: (platform: string, task) => (
      <span className="theme-check__platform-cell">
        <span className={`theme-check__platform ${task.markClass}`}>{task.mark}</span>
        {platform}
      </span>
    ),
  },
  { title: '关键词', dataIndex: 'keywords' },
  { title: '城市', dataIndex: 'city' },
  {
    title: '状态',
    dataIndex: 'status',
    render: (status: Task['status']) => <Tag className={statusClass[status]}>{status}</Tag>,
  },
  {
    title: '进度',
    dataIndex: 'progress',
    width: 160,
    render: (progress: number, task) => (
      <Progress
        percent={progress}
        showInfo={false}
        size="small"
        strokeColor={task.status === '已完成' ? 'var(--co-success)' : 'var(--co-primary)'}
      />
    ),
  },
  {
    title: '新发现',
    dataIndex: 'discovered',
    className: 'theme-check__number',
  },
  {
    title: '操作',
    render: () => <Button size="small">查看</Button>,
  },
];

const tagSamples = [
  ['成功', 'theme-check__tag--success'],
  ['运行中', 'theme-check__tag--primary'],
  ['失败', 'theme-check__tag--danger'],
  ['警告', 'theme-check__tag--warning'],
  ['已取消', 'theme-check__tag--neutral'],
  ['主线A-工业AI', 'theme-check__tag--info'],
  ['探索-RAG', 'theme-check__tag--purple'],
] as const;

const stateDefinitionSamples: StateDefinition[] = [
  { id: 'applied', label: 'Applied', badge_variant: 'primary' },
  { id: 'offer', label: 'Offer', badge_variant: 'success' },
  { id: 'rejected', label: 'Rejected', badge_variant: 'danger' },
];

export default function ThemeCheck() {
  return (
    <main className="theme-check">
      <header className="theme-check__header">
        <div>
          <h1>Ant Design 主题人工对照</h1>
          <p>左侧是 React 中的 Ant Design 组件，右侧是原始设计系统稿。</p>
        </div>
        <a href="/Design System.html" target="_blank" rel="noreferrer">
          单独打开设计稿
        </a>
      </header>

      <div className="theme-check__comparison">
        <section className="theme-check__antd">
          <Card title="统计卡片">
            <div className="theme-check__stats">
              <Card className="theme-check__stat-card">
                <Statistic title="今日采集条数" value={86} />
                <span className="theme-check__delta theme-check__delta--up">较昨日 +18</span>
                <span className="theme-check__stat-icon theme-check__stat-icon--primary">
                  <DownloadOutlined />
                </span>
              </Card>
              <Card className="theme-check__stat-card">
                <Statistic title="Pipeline Pending" value={682} />
                <span className="theme-check__delta theme-check__delta--down">较昨日 -32</span>
                <span className="theme-check__stat-icon theme-check__stat-icon--success">
                  <CheckOutlined />
                </span>
              </Card>
            </div>
          </Card>

          <Card title="按钮">
            <Space wrap>
              <Button type="primary" icon={<DownloadOutlined />}>
                开始采集
              </Button>
              <Button icon={<ReloadOutlined />}>刷新数据</Button>
              <Button className="theme-check__button--soft" icon={<ThunderboltOutlined />}>
                批量处理
              </Button>
              <Button className="theme-check__button--danger-soft">中止任务</Button>
              <Button type="text">查看全部</Button>
              <Button type="primary" disabled>
                开始采集
              </Button>
            </Space>
            <Space wrap className="theme-check__small-buttons">
              <Button type="primary" size="small">
                查看
              </Button>
              <Button size="small">导出 CSV</Button>
              <Button size="small" className="theme-check__button--danger-soft">
                批量移除
              </Button>
            </Space>
          </Card>

          <Card title="标签与标签页">
            <Space wrap>
              {tagSamples.map(([label, className]) => (
                <Tag key={label} className={className}>
                  {label}
                </Tag>
              ))}
              <Tag className="theme-check__tag--success theme-check__tag--pill">强烈推荐</Tag>
            </Space>
            <Tabs
              className="theme-check__tabs"
              items={[
                { key: 'all', label: '全部任务 (24)', children: null },
                { key: 'running', label: '运行中 (3)', children: null },
                { key: 'failed', label: '失败 (1)', children: null },
              ]}
            />
          </Card>

          <Card title="表格">
            <Table columns={columns} dataSource={tasks} pagination={false} size="middle" />
          </Card>

          <Card title="React 公共组件">
            <div className="theme-check__common-grid">
              <StatCard
                label="今日采集条数"
                value={86}
                icon={<DownloadOutlined />}
                delta="较昨日 +18"
                deltaDirection="up"
              />
              <StatCard label="Pipeline Pending" value={682} icon={<CheckOutlined />} tone="success" />
            </div>
            <div className="theme-check__common-row">
              {stateDefinitionSamples.map(({ id, label }) => (
                <StatusBadge
                  key={id}
                  status={id ?? ''}
                  label={label}
                  definitions={stateDefinitionSamples}
                />
              ))}
              <TriStateBadge state="not-started" />
              <TriStateBadge state="generating" />
              <TriStateBadge state="completed" />
            </div>
            <div className="theme-check__common-row">
              <ScoreTag score={4.6} />
              <ScoreTag score={3.3} />
              <PlatformChip variant="liepin" />
              <PlatformChip variant="boss" />
              <PlatformChip variant="zhaopin" />
              <PlatformChip variant="51job" />
            </div>
            <div className="theme-check__strip-frame">
              <StatStrip
                items={[
                  { key: 'pending', label: 'Pending', value: 682, tone: 'primary' },
                  { key: 'processed', label: 'Processed', value: 566 },
                  { key: 'total', label: '总计', value: '1,248' },
                ]}
              />
            </div>
            <EmptyState description="公共空态组件示例" />
          </Card>
        </section>

        <aside className="theme-check__reference">
          <div className="theme-check__reference-title">原始设计稿</div>
          <iframe title="职途原始设计系统稿" src="/Design System.html" />
        </aside>
      </div>
    </main>
  );
}
