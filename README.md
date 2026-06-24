# Career-Ops Local

Career-Ops Local 是「职程」的本地模式独立版。

人话解释：这是一个只在你自己电脑上运行的 AI 求职工具。它可以帮你采集岗位、评估 JD、生成报告、管理投递记录和准备面试；你的真实数据默认留在本地目录里。

## 这个仓库是什么

这是从原项目中剥离出来的本地模式仓库，已移除：

- 云端登录页。
- JWT 登录令牌。
- 公共职位库。
- 服务端多用户数据库。
- 云端部署配置。
- 真实用户数据。

## 快速开始

```bash
npm install
npm --prefix web/server install
npm --prefix web/client install
npm run dev
```

更多步骤见 `docs/SETUP.md`。

## 重要提醒

不要提交真实个人数据：

- `cv.md`
- `config/profile.yml`
- `modes/_profile.md`
- `article-digest.md`
- `portals.yml`
- `data/*`
- `reports/*`
- `output/*`
- `interview-prep/*`

这些都已经写进 `.gitignore`。

## 目录说明

| 目录 | 用途 |
| --- | --- |
| `web/client/` | 浏览器页面 |
| `web/server/` | 本地后端服务 |
| `scrapers/` | 岗位采集脚本 |
| `modes/` | AI 任务提示词 |
| `templates/` | 简历模板和示例配置 |
| `docs/` | 项目说明文档 |
