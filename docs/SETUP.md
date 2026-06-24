# 本地版安装说明

这份说明只适用于 `career-ops-local`，也就是本地模式独立版。

人话解释：你把项目下载安装到自己的电脑上，所有求职数据默认保存在你选择的本地目录里，不需要云端账号。

## 1. 需要先准备什么

1. Node.js 18 或更高版本。
   - Node.js 可以理解成“运行 JavaScript 项目的环境”。
2. Google Chrome。
   - 用来复用你自己的招聘网站登录状态。
3. 一个可用的本地 AI Agent，例如 Codex 或 Cursor。
   - Agent 可以理解成“帮你执行 AI 任务的助手”。
4. 如果要生成 PDF，需要安装 Playwright Chromium。
   - Playwright 可以理解成“自动打开浏览器生成页面/PDF 的工具”。

## 2. 安装依赖

在仓库根目录运行：

```bash
npm install
npm --prefix web/server install
npm --prefix web/client install
npx playwright install chromium
```

## 3. 准备个人文件

这些文件包含你的真实个人信息，默认不会提交到 Git：

```bash
cp config/profile.example.yml config/profile.yml
cp modes/_profile.template.md modes/_profile.md
cp templates/portals.example.yml portals.yml
touch cv.md
touch article-digest.md
```

然后手动填写：

- `cv.md`：你的简历正文。
- `config/profile.yml`：你的求职目标、城市、薪资、偏好。
- `modes/_profile.md`：你的个人叙事、优势、谈薪策略。
- `portals.yml`：你要关注的公司和岗位来源。

## 4. 启动本地 Web

在仓库根目录运行：

```bash
npm run dev
```

这会同时启动：

- 后端：`http://127.0.0.1:3200`
- 前端：通常是 `http://localhost:5173`

打开前端后，页面会让你选择一个工作目录。这个目录会保存：

- `data/`
- `reports/`
- `output/`
- `interview-prep/`

## 5. 检查后端是否正常

```bash
curl http://127.0.0.1:3200/api/health
```

正常结果类似：

```json
{"ok":true,"mode":"local"}
```

## 6. 连接 AI Agent

打开网页右上角的 AI 设置，复制页面给出的 MCP 连接提示词，发给你的本地 Agent。

MCP 可以理解成“网页后端和 AI Agent 之间的通信协议”。连接后，网页可以把评估、面试准备等任务交给 Agent 执行。

## 7. 浏览器采集

采集岗位前，先在本机 Chrome 登录招聘网站账号。系统通过本机 Chrome 的调试接口读取登录状态，不会在服务器保存你的招聘网站密码。

支持脚本见：

- `scrapers/README.md`
- `scrapers/51job/README.md`
- `scrapers/liepin/README.md`
- `scrapers/zhaopin/README.md`

## 8. 注意事项

- 不要提交 `cv.md`、`config/profile.yml`、`modes/_profile.md`、`data/`、`reports/`、`output/` 里的真实内容。
- 如果你把仓库推到远程，即使远程是私有库，也建议只放系统代码和示例文件。
- 本地版不包含云端登录、公共职位库、多用户数据库和云端部署配置。
