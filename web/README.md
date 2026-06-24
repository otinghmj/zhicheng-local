# 职程 Web 本地版

此目录是「职程」本地版的 Web 前后端。

人话解释：`client/` 是你在浏览器里看到的页面，`server/` 是在你电脑上跑的本地服务。页面和服务之间通过 REST API 通信。REST API 可以理解成“前端找后端办事的固定入口”。

## 目录

- `server/`：Express 5 后端，默认监听 `127.0.0.1:3200`。
- `client/`：Vite + React 前端。

## 本地启动

在仓库根目录运行：

```bash
npm run dev
```

也可以分别运行：

```bash
npm run dev:server
npm run dev:client
```

健康检查：

```bash
curl http://127.0.0.1:3200/api/health
```

正常返回：

```json
{"ok":true,"mode":"local"}
```

## 本地版已移除的内容

- 登录页。
- 云端 JWT 登录令牌。
- 公共职位库。
- 服务端多用户数据库。
- 云端埋点接口。

## 数据读写

前端启动后会要求用户选择本地工作目录。真实数据都在这个目录里读写，不需要上传到云端。

常见数据文件：

- `data/applications.md`
- `data/pipeline.md`
- `data/scan-history.tsv`
- `reports/*.md`
- `output/*.pdf`
- `interview-prep/*.md`
