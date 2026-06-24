import {
  AuditOutlined,
  CloudDownloadOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  ProfileOutlined,
  SendOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';

import { BrandMark } from '../brand/BrandMark';
import { useAiConfig } from '../../hooks/useAiTask';
import { AiSettingsModal } from './AiSettingsModal';

const BASE_NAV = [
  { to: '/', label: '仪表盘', icon: DashboardOutlined },
  { to: '/collection', label: '采集任务', icon: CloudDownloadOutlined },
  { to: '/pipeline', label: '待处理队列', icon: FundProjectionScreenOutlined },
  { to: '/reports', label: '评估报告', icon: AuditOutlined },
  { to: '/interview-prep', label: '面试准备', icon: ProfileOutlined },
  { to: '/resumes', label: '简历管理', icon: FileTextOutlined },
  { to: '/applications', label: '投递跟踪', icon: SendOutlined },
];

export function Header() {
  const { config: aiConfig } = useAiConfig();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <NavLink className="app-brand" to="/" aria-label="返回职途仪表盘">
          <BrandMark />
          <span className="app-brand__name">职途</span>
        </NavLink>

        <nav className="app-nav" aria-label="主导航">
          {BASE_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              end={to === '/'}
              to={to}
              className={({ isActive }) =>
                `app-nav__item${isActive ? ' app-nav__item--active' : ''}`
              }
            >
              <Icon className="app-nav__icon" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="app-header__right">
          <button
            className="app-notification"
            type="button"
            aria-label="AI 设置"
            title={`AI: Agent 模式${(aiConfig?.agentConnections ?? 0) > 0 ? ` (${aiConfig!.agentConnections} 连接)` : ''}`}
            onClick={() => setSettingsOpen(true)}
          >
            <SettingOutlined />
          </button>

          <AiSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} config={aiConfig} />

          <button className="app-user" type="button" aria-label="用户菜单">
            <span className="app-user__avatar">
              U
            </span>
            <span className="app-user__details">
              <span className="app-user__name">用户</span>
              <span className="app-user__meta">本地目录</span>
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
