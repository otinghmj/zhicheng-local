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

  if (status === 'unsupported') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: 16 }}>
        <Card style={{ maxWidth: 560, width: '100%' }}>
          <Result
            status="warning"
            title="当前浏览器不支持本地目录访问"
            subTitle={
              <div style={{ textAlign: 'left', lineHeight: 1.9 }}>
                <p>
                  本地版需要浏览器的「文件系统访问」能力（File System Access API）来读写你选择的工作目录，
                  但当前环境不支持它。<strong>最常见的原因是用 VS Code 内置的 Simple Browser / 内嵌预览窗口打开了本页。</strong>
                </p>
                <p style={{ marginBottom: 4 }}>请改用以下方式打开，采集等功能即可正常使用：</p>
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  <li>
                    用<strong>独立的 Chrome 或 Edge 窗口</strong>（不是 VS Code 内嵌浏览器）访问：
                    <div style={{ margin: '6px 0' }}>
                      <code style={{ background: 'var(--co-fill-2, #f0f0f0)', padding: '2px 8px', borderRadius: 4 }}>
                        http://localhost:5173
                      </code>
                    </div>
                  </li>
                  <li>确保地址是 localhost 或 https（安全上下文），Firefox / Safari 暂不支持该能力。</li>
                </ol>
              </div>
            }
            extra={
              <Button type="primary" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
                我已在 Chrome 中打开，重新检测
              </Button>
            }
          />
        </Card>
      </div>
    );
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
