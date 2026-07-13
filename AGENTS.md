# AGENTS.md — 用任意 Agent 驱动职程

这份文件是**给 AI Agent 读的操作契约**。无论你是 Claude Code、Cursor、Codex 还是其它支持 MCP 的工具，读完这一页就能像用一个 skill 一样驱动「职程本地版」。

> 人类用户看仓库结构和边界，请读 `CLAUDE.md`；文件归属规则见 `DATA_CONTRACT.md`。

## 你的角色

职程本地版是一个跑在用户电脑上的 AI 求职工作台。分工是：

- **Web Server（本地 Express，`http://localhost:3200`）**：统一操作入口。它自己直接负责本地"体力活"——启动调试 Chrome、跑采集脚本、生成 PDF、读写数据文件。
- **你（Agent）**：只负责需要 LLM 的"脑力活"——岗位评估、报告生成、面试准备、简历打磨、采集配置建议等。Web UI 把这类任务下发，由你执行并把产物写回文件。

你**不需要**自己去启动 Chrome 或跑采集脚本（那是服务端的事）。你要做的是领任务、用你自己的工具/模型执行 prompt、把结果写进指定文件。

## 一、连接（一次性）

MCP 端点固定为 `http://localhost:3200/mcp`（Streamable HTTP）。

- **Claude Code**：项目根已内置 `.mcp.json`，在本项目目录打开即自动识别；或运行 `npm run mcp:setup`。
- **Cursor**：`npm run mcp:setup` 会写入 `~/.cursor/mcp.json`。
- **任意其它 Agent**：运行 `npm run mcp:print` 拿到可粘贴的配置片段，按你自己的 MCP 配置方式添加该 URL。

连接后你会获得 4 个 MCP 工具：`claim_task`、`report_progress`、`complete_task`、`get_status`。

## 二、执行循环（核心）

用户在 Web UI 点"AI 评估""一键 AI 采集""生成报告"等按钮时，服务端会把任务入队。你有两种方式拿到它：

**方式 A · 轮询（对任意 Agent 都通用，推荐）**

当用户在使用职程时，按固定间隔（约每 5 秒）执行以下循环：

1. 调 `claim_task`。返回 `status: "empty"` 就等下一轮；返回 `status: "claimed"` 则拿到 `{ jobId, mode, target, args, prompt }`。
2. `prompt` 是**完全自包含**的——已拼好共享上下文（`modes/_shared.md`）、用户画像（`modes/_profile.md`）、简历（`cv.md`）和该 mode 的指令。直接按 `prompt` 执行，用你自己的 Read/Write/WebSearch 等工具，**不要再向用户确认**。
3. 执行中用 `report_progress(jobId, step, current, total)` 上报进度，Web UI 会实时显示。
4. 产物按 mode 要求写入对应文件（见"四、文件契约"）。
5. 调 `complete_task(jobId, success, output)` 收尾；失败则 `complete_task(jobId, false, error=...)`。

**方式 B · 采样推送（若你的 MCP 客户端支持 sampling）**

有些客户端支持服务端反向 `createMessage`。这种情况下服务端会直接把 `prompt` 推给你，你执行后返回文本即可，无需轮询。不确定是否支持就用方式 A。

## 三、可用 mode 一览

任务的 `mode` 字段对应 `modes/<mode>.md` 里的详细指令（已随 prompt 一起下发）。常用：

| mode | 作用 |
|------|------|
| `scan` | 按 `portals.yml` 生成/优化采集配置、做初筛 |
| `oferta` / `ofertas` | 单个 / 多个岗位评估打分 |
| `pre-filter` | 岗位批量初筛去噪 |
| `pipeline` / `auto-pipeline` | 处理 URL 收件箱、串起评估流水线 |
| `pdf` | 生成简历 / cover letter PDF（底层调 `node generate-pdf.mjs`） |
| `apply` | 投递材料助手 |
| `contacto` | LinkedIn 触达文案 |
| `interview-prep` / `deep-prep-*` | 面试准备、沉浸训练、角色扮演、模拟 |
| `cv-deep-dive` | 简历深挖打磨 |
| `tracker` | 更新投递跟踪 |
| `project` / `training` | 作品集项目 / 培训评估 |

完整允许列表见 `web/server/src/services/ai-task-runner.mjs` 的 `ALLOWED_MODES`。

## 四、文件契约（读哪写哪）

只读（用户数据，**绝不修改**）：`cv.md`、`config/profile.yml`、`modes/_profile.md`、`article-digest.md`、`portals.yml`。

写入（你的产物）：

- 评估报告 → `reports/*.md`（报告头必须含 `**URL:**`）。
- 投递跟踪 → **不要直接改 `data/applications.md`**；把新增行以 TSV 写到 `batch/tracker-additions/`。
- PDF → `output/`。
- 采集配置 → `portals.yml`（`scan` mode 的 `generate-config`）。
- 面试材料 → `interview-prep/`。
- 岗位描述 → `jds/`。

完整归属见 `DATA_CONTRACT.md`。全局评分规则、NEVER/ALWAYS 清单见 `modes/_shared.md`（每个任务 prompt 里都已包含，遵守即可）。

## 五、排查

- Web UI 显示"暂无 Agent 连接"：确认后端已 `npm start`，且你的 MCP 配置指向 `http://localhost:3200/mcp`，然后重启 Agent。用 `npm run mcp:print` 核对配置。
- `claim_task` 一直 `empty`：说明用户还没从 Web UI 下发任务，正常。
- 采集/Chrome 相关的启动由服务端和 Web UI 负责，不在你的职责内；采集脚本跨平台由 `scrapers/shared/ensure-chrome.mjs` 处理。
