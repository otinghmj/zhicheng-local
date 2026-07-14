# AGENTS.md — 用任意 Agent 驱动职程

这份文件是**给 AI Agent 读的操作契约**。无论你是 Claude Code、Cursor、Codex 还是其它工具，读完这一页就能像用一个 skill 一样端到端驱动「职程本地版」。

> 人类用户看仓库结构和边界，请读 `CLAUDE.md`；文件归属规则见 `DATA_CONTRACT.md`。

## 核心理念

**一切操作由你（Agent）用自己的 Read / Write / Bash 工具直接完成；本地 Web 前端只是只读看板，用来展示你写出的结果。** 用户不在网页里点按钮，只对你说一句话（"采集猎聘北京的AI岗位并评估前10个"），你负责把整条链路跑完，产物写进工作目录，用户打开看板就能看到。

这样也顺带避免了浏览器环境限制——用户用任何浏览器（含 VS Code 内嵌）看看板都行，因为看板只读、不碰文件系统。

三个角色：

- **你（Agent）= 执行器**：建工作目录、跑采集脚本、做评估/报告/面试准备、写产物。
- **Web Server（本地，`http://localhost:3200`）= 只读展示 API**：从工作目录读数据（`/api/data/*`），配合 SSE 实时推给看板。
- **浏览器前端 = 纯看板**：只发 HTTP GET，不做任何写操作。

## 从零冷启动（收到"安装并运行职程"类请求时，先完整做这段）

你在用户机器上有终端访问权。按顺序执行，缺什么装什么，每步失败先解决再继续。

### 0. 定位项目

- 当前目录若已是本仓库（能看到本文件 `AGENTS.md`、`package.json`），进入第 1 步。
- 否则克隆（缺 `git` 先装 git）：

  ```bash
  git clone https://github.com/otinghmj/zhicheng-local.git zhicheng && cd zhicheng
  ```

### 1. 装 Node.js ≥ 18（运行时）

先 `node -v` 检查。缺失或低于 18 就装，按操作系统选：

- macOS：`brew install node`（无 Homebrew 先装，或用 `nvm`）
- Debian/Ubuntu：nodesource 脚本，或 `nvm install --lts`
- Windows：`winget install OpenJS.NodeJS.LTS`

系统级安装可能需要用户授权/密码——遇到就提示用户确认后再继续。

### 2. 一键初始化并启动（后台常驻 + 等就绪）

`npm start` 会**一直运行不退出**（它同时起后端和前端），所以**必须放后台**，否则会阻塞你后面所有操作、看起来像卡死。首次还会装依赖（几分钟）。在项目根：

```bash
# Unix/macOS：detached 后台启动，日志落到文件
nohup npm start > /tmp/zhicheng-start.log 2>&1 &
```

用你自己 Agent 的后台/detached 机制也行，**关键是别前台同步等它结束**。启动后**轮询等后端就绪**（首次装依赖较久，重试到通为止）：

```bash
until curl -sf http://localhost:3200/api/health >/dev/null; do sleep 3; done
```

首次会自动装前后端依赖、建工作目录（`data/ reports/ output/ ...` + `cv.md` 等个人文件模板）、写好 MCP 配置，并起后端 `3200` + 前端 `5173`。若长时间不通，看 `/tmp/zhicheng-start.log` 排查（常见：端口被占、Node 版本过低）。

### 3. 按任务补前置依赖

只在要用到时装：

- **采集（猎聘 / 51job）**：需要系统 Chrome。采集脚本会自动拉起一个**独立的调试 Chrome**（`--user-data-dir=chrome-boss-debug`，端口 9223，由 `scrapers/shared/ensure-chrome.mjs` 处理）——它**不是**用户日常那个 Chrome。
  - **登录要在这个调试 Chrome 里做**：首次采集脚本会打开该调试窗口，请提醒用户**在弹出的这个窗口里**登录目标招聘网站（不是平时的 Chrome）。登录态存在 `chrome-boss-debug`，之后复用。这一步你替不了。
- **51job 额外依赖 `opencli`**：前程无忧采集走它，先全局装：`npm i -g @jackwener/opencli`。猎聘不需要。
- **PDF（`pdf` 模式）额外依赖 Playwright Chromium**：`generate-pdf.mjs` 要它；冷启动时若 Playwright 下载失败会被跳过，用到 PDF 前先 `npx playwright install chromium`。

### 4. 告知用户

打开只读看板 `http://localhost:5173`（任意浏览器，含 VS Code 内嵌）。

自举完成后，进入下面的「端到端 Playbook」执行用户的具体任务。

## 端到端 Playbook（主线）

### 0. 确保工作目录就绪（每次开工先做）

```bash
node scripts/init-workspace.mjs        # 幂等：建 data/reports/output/... + 个人文件模板
```

若 `cv.md` / `config/profile.yml` 仍是模板占位，先提示用户填，或按现有内容继续并说明。

### 1. 采集岗位

**所有命令在项目根目录运行。** 两种方式二选一：

- **Claude Code**：可用 `job-scraper` 技能（在 `.claude/skills/`，仅 Claude Code 识别）。
- **任意 Agent（Codex / Cursor 等没有"技能"概念的）**：直接跑脚本：

  ```bash
  node scrapers/liepin/liepin-dom.mjs --query "AI应用工程师" --city 010 --max-pages 3
  node scrapers/51job/51job-opencli.mjs --query "质量工程师" --city 010000 --max-pages 3
  ```

  脚本会**自动把结果写进 `data/pipeline.md`**（除非加 `--skip-pipeline`），看板据此展示，你不用自己写回。

- **城市码**：`--city` 要的是**平台各自的城市码，不是城市名**。查 `scrapers/shared/city-codes.json`，或起服务后 `GET http://localhost:3200/api/config/cities`。例：北京 → 猎聘 `010`、51job `010000`。

采集前置（调试 Chrome 登录、51job 的 `opencli`）见上文「从零冷启动 · 第 3 步」；采集配置在 `portals.yml`，完整流程见 `modes/scan.md`。

### 2. 评估岗位

对每个 JD，读 `modes/_shared.md` + `modes/_profile.md` + `cv.md` + `article-digest.md`，按 `modes/oferta.md`（单个）/ `modes/ofertas.md`（多个）/ `modes/pre-filter.md`（初筛）执行：

- 报告写 `reports/*.md`，报告头必须含 `**URL:**`。
- 投递跟踪：**不要直接改 `data/applications.md`**，把新增行以 TSV 写到 `batch/tracker-additions/`。

### 3. 其它模式（按需）

读对应 `modes/<mode>.md` 执行并写回：`pdf`（`node generate-pdf.mjs` → `output/`，**需先 `npx playwright install chromium`**）、`apply`、`contacto`、`interview-prep` / `deep-prep-*`、`cv-deep-dive`、`pipeline` / `auto-pipeline`、`tracker`、`project` / `training`。完整允许列表见 `web/server/src/services/ai-task-runner.mjs` 的 `ALLOWED_MODES`。

> `modes/*.md` 里有中/英/西语混排，按其中的指令执行即可，别被语言绊住。

### 4. 让用户看结果

产物都在工作目录。若看板没开就起一下：

```bash
npm start        # 首次自动初始化；前端 5173 / 后端 3200
```

前端从 `/api/data/*` 读你写的文件并 SSE 实时刷新。

## 文件契约

只读、绝不修改：`cv.md`、`config/profile.yml`、`modes/_profile.md`、`article-digest.md`、`portals.yml`。

写产物：`reports/*.md`（头含 `**URL:**`）、`output/` PDF、`interview-prep/`、`jds/`；投递跟踪写 TSV 到 `batch/tracker-additions/`。完整归属见 `DATA_CONTRACT.md`；评分与全局 NEVER/ALWAYS 规则见 `modes/_shared.md`。

## 另一条路径：网页下发的任务（MCP 队列，兜底）

给"想在网页里点按钮操作"的用户兜底。连接 MCP（`http://localhost:3200/mcp`，Streamable HTTP）：

- Claude Code：项目根内置 `.mcp.json`，打开本项目即识别；Cursor：`npm run mcp:setup`；其它：`npm run mcp:print` 拿配置。

连接后按轮询循环处理网页下发的任务：约每 5 秒 `claim_task` → 拿到自包含 `prompt` 就执行（不要再向用户确认）→ `report_progress` 上报 → `complete_task` 收尾。工具与细节见 `docs/mcp-agent-setup.md`。

## 排查

- **`npm start` 卡住不返回**：正常——它是常驻进程，必须后台运行（见「从零冷启动 · 第 2 步」），然后轮询 `/api/health` 等就绪，别前台同步等它。
- **`opencli: command not found`**（51job 采集）：`npm i -g @jackwener/opencli`。
- **PDF 报 chromium/executable 不存在**：`npx playwright install chromium`。
- **端口 3200 / 5173 被占**：先停占用进程，或用 `SERVER_PORT` 改后端端口后重启。
- **采集提示"未登录"但用户说已登录**：登录要在脚本拉起的**调试 Chrome**（`chrome-boss-debug`）里做，不是日常 Chrome。
- **看板显示"暂无数据"**：确认 `npm start` 已起、工作目录里有你写的文件（`data/`、`reports/`）。
- **网页任务路径 `claim_task` 一直 empty**：说明用户没从网页下发任务，正常——直驱路径不需要它。
