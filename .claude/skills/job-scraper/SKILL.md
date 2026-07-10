---
name: job-scraper
description: |
  中国主流招聘平台职位数据采集接口，覆盖猎聘、前程无忧。
  提供两个核心能力：
  1. 搜索职位列表 — 按关键词+城市批量搜索，返回结构化职位数组
  2. 获取JD详情 — 传入职位URL/ID返回完整职位描述（猎聘、前程无忧支持）

  当用户或其他技能需要从任何招聘平台获取职位数据时触发，包括：
  - "搜索猎聘SQE岗位，北京，10页"
  - "51job搜广州质量工程师，5页"
  - "查一下这个猎聘职位的完整JD"
  - 任何需要从招聘网站批量获取职位信息的场景
  务必在任何涉及职位数据采集的场景下使用此技能，即使用户没有点名平台也要触发。
---

# 招聘平台采集接口

这个技能是**数据采集接口**：输入平台+关键词+城市，返回结构化职位数据。
不负责数据写到哪里、存入什么系统——那是调用方的职责。

---

## 第一步：识别平台

从用户输入中识别目标平台：

| 用户提到 | 平台 | 读取参考文件 |
|---------|------|------------|
| 猎聘、liepin | 猎聘 | `references/liepin.md` |
| 51job、前程无忧 | 前程无忧 | `references/51job.md` |

用户未指定平台时，**询问用户**选择哪个平台，或根据上下文（如已有某平台的 URL）自动判断。

识别到平台后，**立即读取对应的参考文件**，其中包含该平台的具体脚本命令和参数说明。

---

## 第二步：环境检测

执行前定位采集脚本根目录：

```bash
node -e '
let d = process.cwd();
while (true) {
  if (require("fs").existsSync(require("path").join(d, "scrapers/shared/city-codes.json"))) { console.log(d); process.exit(0); }
  const p = require("path").dirname(d);
  if (p === d) break;
  d = p;
}
console.log("NOT_FOUND");
'
```

若返回 `NOT_FOUND`，告知用户需要在包含 `scrapers/` 的项目目录下运行。

---

## 第三步：查询城市码

各平台城市码格式不同，统一通过查询工具获取，**无需手动记忆**：

```bash
# 查询某平台的城市码
node scrapers/shared/city-codes.mjs get <platform> <城市名>
# 示例：
node scrapers/shared/city-codes.mjs get liepin 上海    # → 020
node scrapers/shared/city-codes.mjs get 51job 广州     # → 030200
```

常用城市快查（详细列表见各平台参考文件）：

| 城市 | liepin | 51job |
|------|--------|-------|
| 全国 | 410 | 000000 |
| 北京 | 010 | 010000 |
| 上海 | 020 | 020000 |
| 深圳 | 050090 | 040000 |
| 广州 | 050020 | 030200 |

---

## 通用输出接口

无论哪个平台，采集接口均**返回职位数组**给调用方，而不是只说"报告保存到了某路径"：

```
dedupJobs[]  去重后的职位数组，每条至少包含：
  jobName      职位名称
  brandName    公司名称
  salaryDesc   薪资描述
  cityName     城市
  url          职位相关 URL（注意：字段名是 url，不是 jobUrl）
dedupCount   去重后实际职位数
reportPath   脚本保存的本地报告路径（供调用方按需使用）
```

---

## 采集后必须执行初筛（pre-filter）

**所有平台采集时必须加 `--skip-pipeline` 参数**，禁止自动写入 pipeline.md。
采集完成后，Claude 读取 `reportPath` 对应的 report.json，执行 `modes/pre-filter.md` 中定义的初筛逻辑，只将通过初筛（默认 ≥3.0 分）的职位写入 `data/pipeline.md`。

**原因**：采集层产出的是无 JD 的简易列表，直接全量写入 pipeline 会导致分析层产生大量噪音评估。初筛层用候选人档案（profile.yml + _profile.md）做方向/薪资/行业三维快速过滤，把 20-100 条缩减到 5-15 条高价值候选，再交给分析层做完整 A-F 评估。

示例命令（加 `--skip-pipeline`，`--max-pages` 必须覆盖全部数据，禁止截断）：
```bash
node scrapers/liepin/liepin-dom.mjs --query AI应用工程师 --city 上海 --max-pages 50 --skip-pipeline
node scrapers/51job/51job-opencli.mjs --query AI应用工程师 --city 020000 --max-pages 34 --skip-pipeline
```

采集完成后，Claude 自动读取 report.json 并调用 pre-filter 模式：
```
[采集完成，共 N 条] → 读取 modes/pre-filter.md → 三维评分 → 写入 pipeline.md（仅通过条目）
```

---

## 各平台能力对比

| 能力 | 猎聘 | 51job |
|------|------|-------|
| 无浏览器采集 | ❌（需 Chrome CDP） | ❌ |
| JD 详情接口 | ✅ | ✅ |
| 主采集模式 | CDP-DOM | OpenCLI |
| 需要登录 Chrome | 必需（调试端口） | 必需（Browser Bridge）|

---

## Chrome 环境要求（CDP 通用）

所有平台均要求**只有一个 Chrome 实例运行，且该实例开启了调试端口**。猎聘为纯 CDP（无 Hammerspoon），前程无忧为 OpenCLI：

```bash
# macOS：一键重置 Chrome（关闭所有标签页后重启）
pkill -f "Google Chrome"; open -a "Google Chrome" --args --remote-debugging-port=9223

# Windows（PowerShell）：
Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue; & "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223
```

> **为什么必须同一个实例、且尽量单 tab？**
> CDP 通过调试端口导航页面并读取数据；多个招聘站 tab 并存会导致读取绑错 tab、返回空结果。所有导航与数据提取都在同一 Chrome 进程内完成。

各脚本在启动时会自动检查：
- 若检测到双 Chrome 实例（调试 Chrome + 普通 Chrome 并存）→ 自动关闭调试 Chrome 并给出重启指引
- 若调试端口未就绪 → 直接报错并按当前系统（Mac/Win）打印修复命令

---

## 首次使用：一次性登录初始化（推荐）

新用户（或换机 / Cookie 过期后）**先跑一次登录初始化**，一次性把两个平台都登录好，之后采集就不会被逐个平台打断：

```bash
node scrapers/shared/auth-init.mjs                 # 检查全部平台，未登录的自动打开登录页并等待
node scrapers/shared/auth-init.mjs --platform liepin,51job   # 只初始化指定平台
node scrapers/shared/auth-init.mjs --check-only    # 只诊断登录状态，不等待
```

登录态识别方式：
- **每次采集前**都会检测对应平台登录状态（默认只做 cookie 快速预检；51job 会检测，猎聘匿名可搜、仅给未登录的非阻塞提示）。
- cookie 缺失或过期 → 自动打开登录页、轮询等待你手动登录。
- **cookie 还在但服务端已失效**（别处登出/会话撤销）默认预检发现不了；此时若采集到 0 条会**回查并提示重新登录**。想每次都严格用浏览器内 API 验证，设 `SCRAPER_VERIFY_LOGIN=1`。

---

## 环境变量 / 配置（换人换机时改这里，不用改代码）

所有可调项都走环境变量，默认值适用于本机 macOS 单人使用。分享给他人、换安装位置或换系统时，按需覆盖即可（脚本会自动按系统适配 Chrome 路径与启动方式，支持 macOS / Windows）：

| 环境变量 | 作用 | 默认值 |
|---------|------|--------|
| `SCRAPER_LAUNCH_MODE` | 浏览器来源：`external`=连你手动开的系统 Chrome；`managed`=工具用 Playwright 自带 Chromium 自动拉起（headed，跨平台，登录态持久化到专属 profile，需先 `npx playwright install chromium`，首次在弹出窗口登录各平台） | `external` |
| `CHROME_PATH` | 系统 Chrome 可执行文件路径（仅 external 模式用） | 自动按系统探测（macOS `/Applications/Google Chrome.app/...`；Windows `Program Files\Google\Chrome\Application\chrome.exe`） |
| `SCRAPER_CDP_URL` | Chrome 调试端口地址 | `http://127.0.0.1:9223` |
| `SCRAPER_API_PORT` | 内部 api-server 端口 | `3337` |
| `SCRAPER_OUTPUT_DIR` | 采集结果输出根目录 | `<项目根>/output` |
| `SCRAPER_PIPELINE_PATH` | `pipeline.md` 写入路径 | `<项目根>/data/pipeline.md` |
| `SCRAPER_PAGE_PAUSE_MS` / `SCRAPER_PAGE_JITTER_MS` | 猎聘页间等待（毫秒） | `8000` / `7000` |
| `LIEPIN_INTER_QUERY_MS` | 猎聘查询间冷却（毫秒） | `180000` |
| `BOSS_API_KEY` | api-server 鉴权密钥（可选） | 空 |
| `SCRAPER_DEBUG` | 设为任意非空值时输出 `[dbg]` 调试日志（暴露响应体解析失败等静默失败），排障用 | 空 |
| `SCRAPER_VERIFY_LOGIN` | 设为任意非空值时，采集前强制浏览器内 API 验证登录（能识别 cookie 还在但服务端已失效）；默认只做 cookie 快速预检 | 空 |

> **兼容说明**：`SCRAPER_CDP_URL` / `SCRAPER_API_PORT` 的旧名 `BOSS_CDP_URL` / `BOSS_API_PORT` 仍然有效（旧脚本无需改动）。
> **项目根**由脚本自身位置自动定位，不依赖你在哪个目录运行命令。

---

## 硬性采集约束（不可违反）

### 约束 1：完整遍历

每个采集条件（关键词 × 城市）**必须采集该条件下的全部数据**，不允许通过 `--max-pages` 截断。

执行规则：
- **猎聘**：`--max-pages` 设为平台返回的实际总页数（API 首页返回 `totalPages`）。若首页返回 10 页，就翻满 10 页。
- **前程无忧**：`--max-pages` 设为 `ceil(平台总数 / 30)`。51job 最多返回约 1000 条，`--max-pages 34` 即可覆盖。

> **禁止**：`--max-pages 3` 这种硬编码截断。每次调用必须根据平台实际数据量动态设定。

### 约束 2：同平台串行

**同一平台的多个采集任务必须串行执行**，前一个完成后才能启动下一个。

- ✅ 猎聘任务A完成 → 猎聘任务B开始
- ❌ 猎聘任务A 和 猎聘任务B 同时执行
- ✅ 不同平台之间可以交替（猎聘 → 前程无忧 → 猎聘），但同一时刻只有一个平台任务在运行

> **原因**：并行请求会加倍触发风控，且同一 Chrome 同一时刻只能操作一个页面。

---

## 采集频率（极保守模式）

以下频率按**模拟真人浏览行为**设计，优先稳定性而非速度。

| 平台 | 查询间隔 | 页间间隔 | 单查询耗时估算 | 每小时查询数 |
|------|---------|---------|--------------|------------|
| 猎聘（API） | ≥ 5 分钟（脚本内置冷却） | ≥ 8s | 5-15 分钟（视页数） | ≤ 6 |
| 前程无忧（OpenCLI） | ≥ 2 分钟 | 内置 | 1-3 分钟 | ≤ 12 |

**猎聘特别说明**：
- 脚本内置 3 分钟锁+冷却机制，不可绕过
- 遇到 HTTP 429 后必须等待 10 分钟再重试
- JD 详情：`--concurrency 1 --delay 15000`（15s 间隔）

```bash
# JD 详情批量拉取
node scrapers/liepin/liepin-jd-fetch.mjs --report <path> --concurrency 1 --delay 15000
```

---

## 错误处理（通用）

| 错误 | 处理 |
|------|------|
| `NOT_FOUND`（脚本路径） | 提示用户切换到含 `scrapers/` 的项目目录 |
| `API server 未就绪` | `lsof -i:3337`，必要时 `pkill -f api-server.mjs` |
| `0 条结果` | 验证城市码，换关键词，或选全国 |
| Chrome 未启动/未登录 | CDP 模式依赖 Chrome 调试端口 9223，需提前登录对应平台 |
| 双 Chrome 实例 | 脚本自动处理：关闭 debug Chrome，再按提示重启普通 Chrome |

---

## ⚠️ 替换主采集脚本时的强制流程

**必须严格按顺序执行，最后一步验证通过才算完成。**

### 步骤

1. **更新注册表**（唯一真值）
   ```bash
   # 编辑 scrapers/registry.json，更新对应平台的 mainScript 和 mode
   ```

2. **编写新脚本**（不动旧脚本）
   - 输出格式必须与旧脚本兼容（`report.json` 的 `dedupJobs` 字段结构不变）
   - CLI 参数保持一致（`--query`/`--city`/`--skip-pipeline` 等）

3. **更新所有文档文件**（共 6 处，缺一不可）

   | 文件 | 更新内容 |
   |------|---------|
   | `scrapers/{platform}/README.md` | 文件组成表、用法示例、技术说明 |
   | `scrapers/shared/README.md` | 被哪些模块依赖 列表 |
   | `项目说明/核心文件索引.md` | 采集脚本行 |
   | `项目说明/目录结构.md` | 目录树注释 + 文件名 |
   | `~/.claude/skills/job-scraper/references/{platform}.md` | 脚本位置、接口命令、技术说明 |
   | `~/.claude/skills/job-scraper/SKILL.md` | 能力对比表 mode 列、采集频率表 |

4. **归档旧脚本**（迁出工具目录，保持 scrapers/ 干净可分享）
   ```bash
   mkdir -p <项目外归档目录>/{platform}
   mv scrapers/{platform}/{old-script}.mjs <项目外归档目录>/{platform}/
   ```

5. **运行一致性检查**（必须全绿才算完成）
   ```bash
   node scrapers/verify-scraper-registry.mjs
   ```
   任何红色错误 → 回到步骤 3 修复，直至 `✅ 全部通过，无错误，无警告`。
