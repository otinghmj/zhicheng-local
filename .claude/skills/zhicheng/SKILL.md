---
name: zhicheng
description: |
  用任意 Agent 驱动「职程本地版」AI 求职工作台。当用户在本项目里让你执行职程的 AI 任务时触发，包括：
  - "帮我连接职程" / "配置职程 MCP"
  - "领取职程的任务" / "职程 Web UI 里点了 AI 评估/一键 AI 采集，帮我跑"
  - 岗位评估打分、生成评估报告、面试准备、简历打磨、采集配置建议
  - 任何"网页下发任务、由 Agent 执行并写回文件"的职程工作流
  当仓库根存在 AGENTS.md 且提到 MCP localhost:3200/mcp、modes/、claim_task 时，都应使用本技能。
---

# 驱动职程（zhicheng）

职程本地版是跑在用户电脑上的 AI 求职工作台。Web Server（`http://localhost:3200`）负责本地体力活（启动 Chrome、跑采集、生成 PDF、读写文件）；**你（Agent）只负责需要 LLM 的脑力活**（评估、报告、面试准备等），通过 MCP 领任务、执行、写回文件。

## 快速上手

1. **连接**：项目根内置 `.mcp.json`，在本项目打开 Claude Code 即自动识别 `zhicheng` MCP（`http://localhost:3200/mcp`）。其它 Agent 用 `npm run mcp:print` 拿配置。
2. **领任务并执行**（核心循环）：
   - 调 `claim_task`。`empty` 就等；`claimed` 则拿到 `{ jobId, mode, target, args, prompt }`。
   - `prompt` 完全自包含（已含 `_shared.md` + `_profile.md` + `cv.md` + 该 mode 指令），直接执行，**不要再向用户确认**。
   - 用 `report_progress(jobId, step, current, total)` 上报进度。
   - 产物按 mode 写入对应文件。
   - 用 `complete_task(jobId, success, output)` 收尾。
3. 用户在使用职程时，按约每 5 秒轮询一次 `claim_task`。

## 文件契约（详见项目根 AGENTS.md 与 DATA_CONTRACT.md）

- 只读、绝不修改：`cv.md`、`config/profile.yml`、`modes/_profile.md`、`article-digest.md`、`portals.yml`
- 写产物：`reports/*.md`（报告头含 `**URL:**`）、`output/` PDF、`interview-prep/`、`jds/`；投递跟踪写 TSV 到 `batch/tracker-additions/`，**不要直接改 `data/applications.md`**。

**完整操作契约以项目根 `AGENTS.md` 为准**——遇到细节先读它。
