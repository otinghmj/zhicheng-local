# Career-Ops MCP Agent 连接指南

## 概述

Career-Ops 支持通过 MCP（Model Context Protocol）协议连接外部 AI Agent，实现 Web UI 下发任务、Agent 自动执行的工作流。

## 连接步骤

### 1. 确保后端已启动

```bash
cd web/server && npm start
```

默认监听 `http://localhost:3200`，MCP 端点为 `/mcp`。

### 2. 在 AI Agent 中添加 MCP Server

#### Claude Code

在项目根目录的 `.mcp.json` 的 `mcpServers` 中添加（本地开发用 `localhost`，部署后替换为实际域名）：

```json
{
  "mcpServers": {
    "career-ops": {
      "url": "http://localhost:3200/mcp"
    }
  }
}
```

#### Cursor

在 `~/.cursor/mcp.json` 中添加：

```json
{
  "mcpServers": {
    "career-ops": {
      "url": "http://localhost:3200/mcp"
    }
  }
}
```

#### 其他支持 MCP 的 Agent

在其 MCP 配置中添加 Streamable HTTP 类型的服务器，URL 为 `http://localhost:3200/mcp`。

### 3. 重启 Agent

配置写入后需重启 Agent 使 MCP 连接生效。

### 4. 验证

连接成功后，Agent 会获得以下 MCP 工具：

| 工具 | 说明 |
|------|------|
| `claim_task` | 领取待执行的 AI 任务 |
| `complete_task` | 提交任务执行结果 |
| `report_progress` | 上报任务执行进度 |
| `get_status` | 查看当前任务状态 |

在 Web UI 的 AI 设置中可看到 Agent 连接数。

## 可用的 MCP 工具

### claim_task

领取队列中的待执行任务。返回任务详情（模式、目标、完整 prompt）。

```
无参数。返回:
- status: "claimed" | "empty"
- jobId, mode, target, args, prompt（仅 claimed 时）
```

### complete_task

提交任务执行结果。

```
参数:
- jobId: string    — 任务 ID
- success: boolean — 是否成功
- output?: string  — 执行输出
- error?: string   — 错误信息
```

### report_progress

上报执行进度，实时推送到 Web UI。

```
参数:
- jobId: string  — 任务 ID
- step: string   — 当前步骤描述
- current: number — 当前进度
- total: number   — 总步骤数
```

### get_status

查看当前运行中的任务状态。

```
无参数。返回当前任务的 jobId, mode, target, progress。
```

## 一键安装 Prompt

将以下提示词复制给你的 AI Agent，它会自动完成配置：

> 帮我连接一个 MCP Server。服务器名称为 "career-ops"，类型为 Streamable HTTP，URL 为 `<你的服务地址>/mcp` 。如果你是 Claude Code，请在项目根目录的 .mcp.json 文件的 mcpServers 中添加 {"career-ops":{"url":"<URL>"}}；如果你是 Cursor，请在 ~/.cursor/mcp.json 中添加同样配置；其他 Agent 请按各自 MCP 配置方式添加。完成后提示我重启 Agent 以生效。

本地开发时 URL 为 `http://localhost:3200/mcp`，部署后替换为实际域名。Web UI 中的一键连接提示词会自动使用当前访问地址。
