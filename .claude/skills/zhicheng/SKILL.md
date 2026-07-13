---
name: zhicheng
description: |
  用任意 Agent 端到端驱动「职程本地版」AI 求职工作台：用户说一句话，Agent 自己建工作目录、跑采集、做评估、写产物，前端只作展示。当用户在本项目里表达求职相关意图时触发，包括：
  - "采集猎聘北京的AI应用岗位并评估前10个"
  - "把这个JD评估一下 / 生成评估报告 / 生成定制PDF简历"
  - "准备这家公司的面试 / 更新我的投递跟踪"
  - "帮我把职程跑起来 / 初始化工作目录 / 连接职程"
  - 任何"采集→评估→报告→投递→面试准备"的求职工作流
  当仓库根存在 AGENTS.md 且涉及 modes/、scrapers/、reports/、data/ 时都应使用本技能。
---

# 端到端驱动职程（zhicheng）

职程本地版是跑在用户电脑上的 AI 求职工作台。**核心理念：一切操作由 Agent（你）用自己的 Read/Write/Bash 工具直接完成；本地 Web 前端只是只读看板，用来展示你写出的结果。** 用户不需要在网页里点按钮，只需对你说一句话。

> 这样设计也顺带避免了浏览器环境限制——用户用什么浏览器（包括 VS Code 内嵌）看看板都行，因为看板只读、不碰文件系统。

## 端到端 Playbook（主线）

收到求职类请求时，按需走下面的链路。每一步都用你自己的工具做，做完把产物写进工作目录，用户去看板刷新即可看到。

### 0. 确保工作目录就绪（每次开工先做）

```bash
node scripts/init-workspace.mjs
```

幂等：建好 `data/ reports/ output/ interview-prep/ jds/ batch/` 和个人文件模板
（`cv.md`、`config/profile.yml`、`modes/_profile.md`、`portals.yml`、`article-digest.md`）。
如果 `cv.md` / `config/profile.yml` 还是模板（内容为占位），先提示用户填，或按现有内容继续并说明。

### 1. 采集岗位

用 **`job-scraper` 技能**（搜索职位列表 + 拉取 JD 详情，覆盖猎聘 / 前程无忧），或直接跑脚本：

```bash
node scrapers/liepin/liepin-dom.mjs --query "AI应用工程师" --city 010 --max-pages 3
node scrapers/51job/51job-opencli.mjs --query "质量工程师" --city 030200 --max-pages 3
```

采集依赖用户本机 Chrome 的登录态；采集器的 Chrome 就绪逻辑由 `scrapers/shared/ensure-chrome.mjs` 处理。
采集配置（关键词/城市/过滤词/跟踪公司）在 `portals.yml`，`modes/scan.md` 有完整的采集与初筛流程说明。

### 2. 评估岗位

对每个 JD，读 `modes/_shared.md`（评分体系与全局规则）+ `modes/_profile.md`（用户画像）+ `cv.md` + `article-digest.md`，再按 `modes/oferta.md`（单个）/ `modes/ofertas.md`（多个）/ `modes/pre-filter.md`（批量初筛）执行：

- 每个岗位产出一份报告写到 `reports/*.md`，报告头必须含 `**URL:**`。
- 登记投递跟踪：**不要直接改 `data/applications.md`**，把新增行以 TSV 写到 `batch/tracker-additions/`。

### 3. 其它模式（按需）

读对应 `modes/<mode>.md` 执行并写回：`pdf`（`node generate-pdf.mjs` 生成简历/cover letter → `output/`）、`apply`、`contacto`、`interview-prep` / `deep-prep-*`、`cv-deep-dive`、`pipeline` / `auto-pipeline`、`tracker`、`project` / `training`。

### 4. 让用户看结果

产物都在工作目录里。若本地看板没开，起一下（后台）：

```bash
npm start   # 首次会自动初始化；前端 http://localhost:5173，后端 http://localhost:3200
```

前端是纯展示：Dashboard / 报告 / Pipeline / 投递 / 面试准备都从后端 `/api/data/*` 读你写的文件，并通过 SSE 实时刷新。

## 文件契约

- 只读、绝不修改：`cv.md`、`config/profile.yml`、`modes/_profile.md`、`article-digest.md`、`portals.yml`
- 写产物：`reports/*.md`、`output/` PDF、`interview-prep/`、`jds/`；投递跟踪写 TSV 到 `batch/tracker-additions/`（不要直接改 `data/applications.md`）。

完整归属见 `DATA_CONTRACT.md`，完整操作契约见项目根 `AGENTS.md`（遇细节先读它）。

## 另一条路径：网页下发的任务（MCP 队列）

如果用户是从 Web UI 点按钮下发任务（而非直接对你说），服务端会把任务入队，你通过 MCP 工具领取：轮询 `claim_task` → 按返回的自包含 `prompt` 执行 → `report_progress` 上报 → `complete_task` 收尾。这条路径的细节见 `docs/mcp-agent-setup.md`。直驱（上面的 Playbook）是主线，这条是给"想在网页里操作"的用户兜底。
