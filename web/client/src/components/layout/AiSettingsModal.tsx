import { Alert, Badge, Button, Modal, Typography, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, CopyOutlined } from '@ant-design/icons';

import type { AiConfig } from '../../hooks/useAiTask';

const { Text, Paragraph } = Typography;

function getMcpUrl() {
  return `${window.location.origin}/mcp`;
}

function buildAgentPrompt() {
  const mcpUrl = getMcpUrl();
  return `帮我连接一个 MCP Server。服务器名称为 "career-ops"，类型为 Streamable HTTP，URL 为 ${mcpUrl} 。如果你是 Claude Code，请在项目根目录的 .mcp.json 文件的 mcpServers 中添加 {"career-ops":{"url":"${mcpUrl}"}}；如果你是 Cursor，请在 ~/.cursor/mcp.json 中添加同样配置；其他 Agent 请按各自 MCP 配置方式添加。完成后提示我重启 Agent 以生效。`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  config: AiConfig | null;
}

export function AiSettingsModal({ open, onClose, config }: Props) {
  const [notice, noticeCtx] = message.useMessage();

  return (
    <Modal
      title="AI 任务配置"
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={520}
      destroyOnClose
    >
      {noticeCtx}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {(config?.agentConnections ?? 0) > 0 ? (
            <Badge status="success" text={<Text strong>已连接 {config!.agentConnections} 个 Agent</Text>} />
          ) : (
            <Badge status="default" text={<Text type="secondary">暂无 Agent 连接</Text>} />
          )}
        </div>

        <Alert
          type={(config?.agentConnections ?? 0) > 0 ? 'success' : 'info'}
          showIcon
          icon={(config?.agentConnections ?? 0) > 0 ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
          message="Agent 模式（MCP 协议）"
          description="所有 AI 任务通过 MCP Server 分发给本地 AI Agent（Claude Code、Cursor 等）执行。数据不离开你的设备，无需额外 API 费用。"
          style={{ marginBottom: 12 }}
        />

        <Alert
          type="warning"
          showIcon
          message="一键连接 Agent"
          description={
            <div>
              <Paragraph style={{ marginBottom: 8 }}>
                将下方提示词复制给你的 AI 助手（Claude Code、Cursor、Codex 等），它会自动完成配置：
              </Paragraph>
              <div style={{ background: 'var(--ant-color-fill-tertiary, #f5f5f5)', padding: '10px 12px', borderRadius: 6, fontSize: 13, lineHeight: 1.6, marginBottom: 8, position: 'relative' }}>
                <Paragraph style={{ margin: 0, paddingRight: 32 }}>{buildAgentPrompt()}</Paragraph>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  style={{ position: 'absolute', top: 6, right: 6 }}
                  onClick={() => { navigator.clipboard.writeText(buildAgentPrompt()); notice.success('已复制到剪贴板'); }}
                />
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Agent 完成配置后需重启，连接状态会自动更新。
              </Text>
            </div>
          }
        />
      </div>
    </Modal>
  );
}
