# 职程本地版

本仓库是「职程」的本地模式独立版。

人话解释：这个版本只跑在用户自己的电脑上。岗位采集、简历、报告、投递记录都默认保存在本地目录里，不包含云端登录、公共职位库、多用户数据库或远程部署逻辑。

## 架构

```text
用户电脑
├── Web Client（React 前端）          仪表盘、采集、报告、简历、投递跟踪
├── Web Server（Express 后端）        本地 REST API，是统一操作入口
├── AI Agent / CLI                   Codex、Cursor 或其他本地 Agent
├── Local Chrome + opencli/CDP        使用用户自己的浏览器登录态采集岗位
├── modes/                           AI 评估和面试准备提示词
├── data/ reports/ output/           用户本地数据和生成结果
└── 用户自己的 LLM API key            DeepSeek、Qwen 或 OpenAI-compatible 模型
```

说明：

- REST API：可以理解成“前端和后端约定好的办事窗口”。
- Agent：可以理解成“帮你执行 AI 任务的本地助手”。
- CDP：Chrome DevTools Protocol，可以理解成“程序和 Chrome 沟通的调试接口”。

## 本地版边界

本仓库保留：

- 本地 Web 前后端。
- 本地目录选择和文件读写。
- 本地 Chrome 登录态采集。
- AI 任务队列和 MCP Agent 连接。
- PDF 生成、报告解析、投递记录和 Pipeline 管理。

本仓库不包含：

- 云端登录页。
- JWT 登录令牌。
- 公共职位库。
- 服务端多用户数据库。
- Railway/Docker 云端部署文件。
- 真实用户数据。

## 关键目录

| 目录 | 用途 |
| --- | --- |
| `web/client/` | React 前端 |
| `web/server/` | Express 本地 API 后端 |
| `modes/` | AI 任务提示词 |
| `templates/` | 简历模板、示例配置 |
| `scrapers/` | 岗位采集脚本 |
| `config/` | 用户资料示例；真实 `profile.yml` 不提交 |
| `data/` | 用户投递和任务数据；只提交 `.gitkeep` |
| `reports/` | 评估报告；只提交 `.gitkeep` |
| `output/` | PDF 输出；只提交 `.gitkeep` |

## 数据规则

用户数据默认不提交：

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

系统文件可以提交和更新：

- `web/*`
- `scrapers/*`
- `templates/*`
- `modes/_shared.md`
- `modes/api-evaluation-prompt.md`
- 其他非用户私密数据的文档和脚本

## 启动

见 `docs/SETUP.md`。
