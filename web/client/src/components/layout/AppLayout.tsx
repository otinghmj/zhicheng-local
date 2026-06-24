import { Outlet } from 'react-router-dom';

import { Header } from './Header';
import { TaskStatusBar } from './TaskStatusBar';
import './layout.css';

export function AppLayout() {
  return (
    <div className="app-layout">
      <Header />
      <Outlet />
      <TaskStatusBar />
    </div>
  );
}
