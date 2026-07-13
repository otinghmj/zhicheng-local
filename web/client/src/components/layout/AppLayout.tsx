import { Outlet } from 'react-router-dom';
import { Alert } from 'antd';

import { Header } from './Header';
import { TaskStatusBar } from './TaskStatusBar';
import './layout.css';

export function AppLayout() {
  return (
    <div className="app-layout">
      <Header />
      <Alert
        banner
        type="info"
        showIcon
        closable
        message="只读看板：采集、评估、编辑等操作请对你的 AI Agent 说，产物会自动出现在这里。"
      />
      <Outlet />
      <TaskStatusBar />
    </div>
  );
}
