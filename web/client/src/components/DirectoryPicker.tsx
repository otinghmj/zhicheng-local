import { useEffect, useRef } from 'react';
import { Button, Card, Result, Spin } from 'antd';
import { FolderOpenOutlined, ReloadOutlined, DisconnectOutlined } from '@ant-design/icons';

import { useDataStore } from '../stores/dataStore';
import { useFsStore } from '../stores/fsStore';

export function DirectoryPicker({ children }: { children: React.ReactNode }) {
  const { status, error, dirHandle, pickDirectory, restoreHandle, disconnect } = useFsStore();
  const { loading: dataLoading, loadAll } = useDataStore();
  const restoreAttempted = useRef(false);

  useEffect(() => {
    if (status === 'idle' && !dirHandle && !restoreAttempted.current) {
      restoreAttempted.current = true;
      void restoreHandle();
    }
  }, [status, dirHandle, restoreHandle]);

  useEffect(() => {
    if (status === 'ready' && dirHandle) {
      void loadAll(dirHandle);
    }
  }, [status, dirHandle, loadAll]);

  if (status === 'restoring' || (status === 'ready' && dataLoading)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip={dataLoading ? '正在加载数据...' : '正在恢复工作目录...'} />
      </div>
    );
  }

  if (status === 'ready' && dirHandle) {
    return <>{children}</>;
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Card style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        {status === 'denied' ? (
          <Result
            status="warning"
            title="需要目录访问权限"
            subTitle="请点击下方按钮重新授权，或选择一个新目录"
            extra={[
              <Button key="retry" icon={<ReloadOutlined />} onClick={() => void restoreHandle()}>
                重新授权
              </Button>,
              <Button key="pick" type="primary" icon={<FolderOpenOutlined />} onClick={() => void pickDirectory()}>
                选择新目录
              </Button>,
            ]}
          />
        ) : status === 'error' ? (
          <Result
            status="error"
            title="目录访问失败"
            subTitle={error ?? '未知错误'}
            extra={
              <Button type="primary" icon={<FolderOpenOutlined />} onClick={() => void pickDirectory()}>
                重新选择
              </Button>
            }
          />
        ) : (
          <Result
            icon={<FolderOpenOutlined style={{ color: 'var(--color-primary)' }} />}
            title="选择工作目录"
            subTitle="所有数据将保存在你选择的本地目录中，不会上传到服务器。你可以选择一个空目录（自动初始化）或已有的职途数据目录。"
            extra={
              <Button type="primary" size="large" icon={<FolderOpenOutlined />} onClick={() => void pickDirectory()}>
                选择目录
              </Button>
            }
          />
        )}
        {dirHandle && (
          <Button
            type="link"
            danger
            icon={<DisconnectOutlined />}
            onClick={() => void disconnect()}
            style={{ marginTop: 8 }}
          >
            断开当前目录
          </Button>
        )}
      </Card>
    </div>
  );
}
