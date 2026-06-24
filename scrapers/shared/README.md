# shared — 共享采集基础服务

BOSS 直聘、智联招聘、前程无忧共用的 HTTP API 服务层，通过 CDP 代理与 Chrome 通信。

## 文件组成

| 文件 | 职责 |
|------|------|
| `api-server.mjs` | HTTP API 服务（默认端口 3337）。通过 CDP 向 Chrome 注入 JS，暴露端点：`/health`、`/api/boss/*`（BOSS直聘采集）、`/api/51job/search/getPage`、`/api/51job/search/nextPage`（前程无忧采集）。支持限流、Cookie session 管理、错误恢复 |
| `city-codes.json` | 四平台城市码数据（51job 3367 条、智联 487 条、BOSS 374 条、猎聘 293 条，含全国）。数据来源：各平台公开页面、JS 或 API |
| `city-codes.mjs` | 城市码查询工具模块。提供 `getCity(platform, name)`、`searchCity(platform, query)` 等函数，可作为 CLI 工具使用 |
| `sync-liepin-city-codes.mjs` | 从猎聘官方城市列表及城市页面同步完整 `dqCode` |

## 城市码查询

```bash
# 查询某城市在某平台的码
node scrapers/shared/city-codes.mjs get boss 佛山        # → 101280800
node scrapers/shared/city-codes.mjs get zhaopin 广州     # → 763
node scrapers/shared/city-codes.mjs get 51job 深圳       # → 040000
node scrapers/shared/city-codes.mjs get liepin 佛山      # → 050050

# 跨平台对比
node scrapers/shared/city-codes.mjs all 成都

# 模糊搜索
node scrapers/shared/city-codes.mjs search boss 苏
```

猎聘城市列表需要更新时运行：

```bash
node scrapers/shared/sync-liepin-city-codes.mjs
```

## 被哪些模块依赖

- `scrapers/boss/boss-hs-rpa.mjs` — 自动启动后执行 BOSS 采集
- `scrapers/zhaopin/zhaopin-hs-rpa.mjs` — 自动启动后执行智联采集
- `scrapers/liepin/liepin-dom.mjs` — 猎聘采集（CDP-DOM 模式，依赖 ensure-chrome.mjs）
- `scrapers/51job/51job-opencli.mjs` — 前程无忧采集（OpenCLI 模式，不依赖 api-server）

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BOSS_API_PORT` | `3337` | 监听端口 |
| `BOSS_CDP_URL` | `http://127.0.0.1:9223` | Chrome CDP 地址 |
| `BOSS_API_RATE_LIMIT_MAX_REQ` | — | 限流上限 |
