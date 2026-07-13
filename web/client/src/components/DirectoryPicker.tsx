import { useEffect } from 'react';
import { Button, Result, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { useDataStore } from '../stores/dataStore';

/**
 * 只读看板的数据网关：从本地后端 /api/data/* 加载数据后渲染看板。
 *
 * 不再依赖浏览器的 File System Access API（showDirectoryPicker）——
 * 所有写操作交给 Agent，前端只读展示，因此任何浏览器（含 VS Code 内嵌）都能用。
 */
export function DirectoryPicker({ children }: { children: React.ReactNode }) {
  const loading = useDataStore((s) => s.loading);
  const error = useDataStore((s) => s.error);
  const loadAll = useDataStore((s) => s.loadAll);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: 16 }}>
        <Result
          status="warning"
          title="数据加载失败"
          subTitle={`${error} —— 请确认本地服务已启动（npm start）后重试。`}
          extra={
            <Button type="primary" icon={<ReloadOutlined />} onClick={() => void loadAll()}>
              重试
            </Button>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
