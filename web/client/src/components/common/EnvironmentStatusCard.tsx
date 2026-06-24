import {
  ApiOutlined,
  FilterOutlined,
  FolderOpenOutlined,
  FundProjectionScreenOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Card, Skeleton, Tag } from 'antd';

import { useDoctorStatus } from '../../hooks/useDoctorStatus';

const ITEMS = [
  { label: '数据目录', icon: <FolderOpenOutlined />, keywords: ['data/', 'output/', 'reports/'] },
  { label: '配置文件', icon: <SettingOutlined />, keywords: ['cv.md', 'profile.yml', 'portals.yml'] },
  { label: 'API 服务', icon: <ApiOutlined />, keywords: ['api-server', 'api service', 'api 服务'] },
  { label: '去重服务', icon: <FilterOutlined />, keywords: ['dependencies'] },
  { label: '评分模型', icon: <FundProjectionScreenOutlined />, keywords: ['node.js'] },
] as const;

function statusTone(status: string) {
  if (status === 'ok') return { dot: 'ok', label: '正常', color: 'success' };
  if (status === 'warn') return { dot: 'warn', label: '警告', color: 'warning' };
  if (status === 'fail') return { dot: 'fail', label: '异常', color: 'error' };
  return { dot: 'unknown', label: '未检测', color: 'default' };
}

export function EnvironmentStatusCard({ className = '' }: { className?: string }) {
  const doctor = useDoctorStatus();

  return (
    <Card className={`environment-status-card ${className}`.trim()} title="环境状态">
      {doctor.loading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
        <div className="environment-status-list">
          {ITEMS.map(({ label, icon, keywords }) => {
            const checks = doctor.checks.filter((check) => keywords.some((keyword) => check.label.toLowerCase().includes(keyword)));
            const rawStatus = !doctor.detected || !checks.length
              ? 'unknown'
              : checks.some((check) => check.status === 'fail')
                ? 'fail'
                : checks.some((check) => check.status === 'warn')
                  ? 'warn'
                  : 'ok';
            const tone = statusTone(rawStatus);
            return (
              <div key={label}>
                <span>{icon}{label}</span>
                <Tag color={tone.color} title={checks.map((check) => check.detail).filter(Boolean).join('\n') || undefined}>
                  <i className={`environment-status-dot environment-status-dot--${tone.dot}`} />
                  {tone.label}
                </Tag>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
