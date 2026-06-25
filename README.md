# 职程

职程是一个本地优先的 AI 求职工作台。

人话解释：它帮你把找工作这件事整理成一条清晰流程：采集岗位、筛选岗位、评估匹配度、生成报告、管理投递进度、准备面试。默认数据都留在你自己的电脑里。

## 适合谁

- 正在找工作，想系统管理岗位和投递进度的人。
- 想用 AI 帮忙看 JD、改简历、准备面试的人。
- 不想把简历、投递记录、岗位分析报告上传到陌生云服务的人。
- 想自己掌控数据和模型配置的人。

## 它能做什么

- 采集招聘网站岗位。
- 把岗位放进待处理队列。
- 用 AI 评估岗位和你的简历是否匹配。
- 生成 Markdown 评估报告。
- 生成定制 PDF 简历。
- 维护投递跟踪表。
- 整理面试准备材料。
- 通过 MCP 连接本地 AI Agent。

MCP 可以理解成“网页和 AI 助手之间的通信协议”。连接后，网页可以把评估、整理、生成报告等任务交给你的本地 AI 助手执行。

## 快速开始

先确认你已经安装：

- Node.js 18 或更高版本。
- Google Chrome。
- Git。

然后运行：

```bash
git clone <你的仓库地址> zhicheng
cd zhicheng
npm run setup
npm start
```

启动后打开：

```text
http://localhost:5173
```

第一次打开页面时，选择一个本地工作目录。之后报告、投递记录、PDF、面试材料都会保存在这个目录里。

## 常用命令

```bash
npm run setup      # 安装依赖，并创建个人配置文件
npm run doctor     # 检查本机环境是否可运行
npm start          # 启动本地 Web
npm run agent      # 启动本地 Agent 连接器
npm run mcp:setup  # 自动写入 Claude Code / Cursor 的 MCP 配置
```

如果你把命令安装到了全局，也可以使用：

```bash
zhicheng setup
zhicheng doctor
zhicheng start
zhicheng agent
```

如果没有全局安装，也可以在项目目录里运行：

```bash
npx . start
```

## 个人文件

`npm run setup` 会帮你创建这些文件：

```text
cv.md
config/profile.yml
modes/_profile.md
portals.yml
article-digest.md
```

你需要手动填写：

- `cv.md`：你的简历。
- `config/profile.yml`：你的目标岗位、城市、薪资、偏好。
- `modes/_profile.md`：你的个人优势、经历叙事、谈薪策略。
- `portals.yml`：你想关注的招聘来源和公司。
- `article-digest.md`：你的项目、作品、文章亮点。

## 数据安全

默认不会提交这些真实数据：

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

这些路径已经写入 `.gitignore`。`.gitignore` 可以理解成“告诉 Git 哪些文件不要上传”的清单。

## 目录结构

```text
web/client/        浏览器页面
web/server/        本地后端服务
scrapers/          岗位采集脚本
modes/             AI 任务提示词
templates/         简历模板和示例配置
data/              投递和任务数据
reports/           评估报告
output/            PDF 输出
interview-prep/    面试准备材料
docs/              详细文档
```

## 本地运行方式

职程默认会启动两个服务：

- 后端：`http://127.0.0.1:3200`
- 前端：`http://localhost:5173`

如果启动失败，先运行：

```bash
npm run doctor
```

它会检查 Node.js、npm、Chrome、依赖目录、端口和个人配置文件。

## 连接 AI Agent

推荐流程：

```bash
npm start
npm run mcp:setup
```

然后重启 Claude Code 或 Cursor。

也可以在网页右上角打开 AI 设置，把提示词复制给你的 AI 助手，让它帮你配置 MCP。

## 注意

- 这个项目是本地优先工具，不是云端 SaaS。
- 招聘网站采集依赖你自己电脑上的 Chrome 登录状态。
- 运行 AI 任务时，是否调用外部模型取决于你配置的 AI Agent 和模型服务。
