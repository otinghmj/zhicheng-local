# 职程本地版安装说明

这份说明面向第一次使用职程的人。

人话解释：你只需要把项目下载到电脑，运行初始化命令，再启动网页。你的简历、报告、投递记录默认都保存在本机。

## 1. 先安装这些东西

### 必须安装

1. Node.js 18 或更高版本。
   - Node.js 可以理解成“运行这个项目的基础环境”。
2. Git。
   - Git 可以理解成“下载和管理代码的工具”。
3. Google Chrome。
   - 采集招聘网站岗位时，会复用你自己 Chrome 里的登录状态。

### 推荐安装

1. Claude Code、Cursor 或 Codex 这类本地 AI Agent。
   - Agent 可以理解成“帮你执行 AI 任务的助手”。

## 2. 下载项目

```bash
git clone <你的仓库地址> zhicheng
cd zhicheng
```

## 3. 一步启动（推荐）

```bash
npm start
```

首次运行时，`npm start` 会自动完成初始化再启动网页，你不用单独跑 `npm run setup`。它会做几件事：

- 安装前端和后端依赖。
- 安装 Playwright Chromium（失败也不影响启动，只影响 PDF 生成）。
- 创建本地数据目录和个人配置文件模板。
- 写好本机 Agent（Claude Code / Cursor）的 MCP 配置。
- 启动本地网页。

Playwright 可以理解成“自动控制浏览器的工具”，这里主要用于生成 PDF。

如果你想单独做初始化（不启动），仍可运行 `npm run setup`。

## 4. 检查环境

```bash
npm run doctor
```

它会检查：

- Node.js 版本。
- npm 是否可用。
- 依赖是否安装完整。
- Chrome 是否存在。
- 常用端口是否被占用。
- 个人配置文件是否存在。

## 5. 打开网页

启动后打开：

```text
http://localhost:5173
```

如果浏览器没有自动打开，就手动复制上面的地址。请用**独立的 Chrome / Edge 窗口**打开，不要用 VS Code 内嵌浏览器 / Firefox / Safari（选择工作目录依赖它们不支持的 File System Access API）。

## 6. 填写个人文件

初始化后会出现这些文件：

```text
cv.md
config/profile.yml
modes/_profile.md
portals.yml
article-digest.md
```

你需要填写：

- `cv.md`：你的简历正文。
- `config/profile.yml`：你的求职目标、城市、薪资和偏好。
- `modes/_profile.md`：你的经历叙事、优势和谈薪策略。
- `portals.yml`：你想关注的招聘来源。
- `article-digest.md`：你的作品、文章、项目亮点。

## 7. 连接 AI Agent

推荐方式：

```bash
npm start
npm run mcp:setup
```

然后重启你的 Agent。Claude Code 在本项目目录打开即自动识别（项目根内置 `.mcp.json`）；Cursor 由上面命令写入配置；Codex 等其它 Agent 运行 `npm run mcp:print` 拿配置片段自行添加。

MCP 可以理解成“网页和 AI Agent 之间的通信协议”。连接后，网页可以把评估、报告生成、面试准备等任务交给 Agent 执行。Agent 连接后请阅读项目根 `AGENTS.md`——一份面向任意 Agent 的操作契约。

你也可以在网页右上角打开 AI 设置，复制提示词给你的 AI 助手，让它自动配置。

## 8. 常用命令

```bash
npm run setup      # 初始化
npm run doctor     # 检查环境
npm start          # 启动本地 Web
npm run mcp:setup  # 为 Claude Code / Cursor 自动写入 MCP 配置
npm run mcp:print  # 打印任意 Agent 可用的 MCP 配置
npm run mcp:remove # 移除 MCP 配置
npm run 51job:opencli # 运行前程无忧采集器
npm run liepin:dom    # 运行猎聘采集器
```

如果你全局安装了命令，也可以用：

```bash
zhicheng setup
zhicheng doctor
zhicheng start
zhicheng mcp:setup
```

## 9. 当前支持的采集器

采集器可以理解成“从招聘网站页面里提取岗位信息的小工具”。

当前正式支持：

- 猎聘：使用本机 Chrome 页面采集。
- 前程无忧（51job）：使用 OpenCLI 采集。

BOSS 直聘和智联招聘的旧采集器依赖 Hammerspoon。Hammerspoon 可以理解成“macOS 上的自动点击工具”。它对普通用户来说不够稳定，所以已经从本地大众版中移除。

## 10. 数据安全提醒

不要提交这些真实个人数据：

- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- `article-digest.md`
- `portals.yml`
- `data/*`
- `reports/*`
- `output/*`
- `interview-prep/*`
- `jds/*`

这些路径已经写进 `.gitignore`。
