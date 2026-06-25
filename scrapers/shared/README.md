# shared — 共享采集工具

这里放采集器共用的小工具，例如 Chrome 启动、登录检查和城市码查询。

## 文件组成

| 文件 | 职责 |
|------|------|
| `ensure-chrome.mjs` | 检查并启动可调试的 Chrome |
| `check-login.mjs` | 检查招聘网站登录状态 |
| `auth-init.mjs` | 一次性检查当前支持平台的登录状态 |
| `city-codes.json` | 城市码数据。正式入口只使用前程无忧和猎聘 |
| `city-codes.mjs` | 城市码查询工具模块。提供 `getCity(platform, name)`、`searchCity(platform, query)` 等函数，可作为 CLI 工具使用 |
| `sync-liepin-city-codes.mjs` | 从猎聘官方城市列表及城市页面同步完整 `dqCode` |

## 城市码查询

```bash
# 查询某城市在某平台的码
node scrapers/shared/city-codes.mjs get 51job 深圳       # → 040000
node scrapers/shared/city-codes.mjs get liepin 佛山      # → 050050

# 跨平台对比
node scrapers/shared/city-codes.mjs all 成都

# 模糊搜索
node scrapers/shared/city-codes.mjs search 51job 苏
```

猎聘城市列表需要更新时运行：

```bash
node scrapers/shared/sync-liepin-city-codes.mjs
```

## 被哪些模块依赖

- `scrapers/liepin/liepin-dom.mjs` — 猎聘采集（CDP-DOM 模式，依赖 ensure-chrome.mjs）
- `scrapers/51job/51job-opencli.mjs` — 前程无忧采集（OpenCLI 模式）

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CDP_URL` | `http://127.0.0.1:9223` | Chrome CDP 地址 |
| `BOSS_CDP_URL` | `http://127.0.0.1:9223` | 兼容旧脚本的 Chrome CDP 地址变量 |
