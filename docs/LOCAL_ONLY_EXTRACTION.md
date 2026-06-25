# 本地模式剥离记录

日期：2026-06-24

## 做了什么

把原项目中的本地模式剥离为独立仓库：`zhicheng-local`。

人话解释：新仓库只保留“在用户自己电脑上跑”的那部分，不再混入云端登录、公共职位库和多用户数据库。

## 保留内容

- React 前端。
- Express 本地后端。
- 本地目录选择和文件读写。
- 本地 Chrome 登录态采集。
- AI Agent / MCP 任务连接。
- PDF 生成。
- 投递记录、Pipeline、报告、面试准备等本地文件解析。

## 移除内容

- `Dockerfile`
- `railway.json`
- `deploy/`
- 云端登录页面和前端认证状态。
- 服务端认证路由。
- JWT 令牌服务。
- 公共职位库路由。
- 服务端数据库服务。
- 云端埋点路由。
- 旧的云端/产品化设计稿。
- 真实用户数据。

## 关键代码变化

- `web/server/src/index.mjs`：固定本地模式，默认监听 `127.0.0.1`。
- `web/server/src/app.mjs`：不再挂载登录、公共职位库、埋点接口。
- `web/server/src/routes/health.mjs`：健康检查返回 `{ ok: true, mode: "local" }`。
- `web/client/src/App.tsx`：删除登录页和公共职位库路由。
- `web/client/src/components/DirectoryPicker.tsx`：始终走本地目录选择流程。
- `web/client/src/components/layout/Header.tsx`：只保留本地功能导航。
- `web/client/src/stores/fsStore.ts`：目录授权不再按用户账号区分。

## 数据保护

新仓库默认忽略以下真实用户数据：

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

只保留 `.gitkeep` 来记录空目录。

## 未做的事

- 没有把真实简历、真实报告、真实投递记录推入新仓库。
- 没有自动执行 `npm audit fix`，避免依赖升级带来额外不确定变化。
