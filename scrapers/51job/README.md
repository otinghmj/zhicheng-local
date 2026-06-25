# 51job — 前程无忧采集模块

## 文件组成

| 文件 | 职责 |
|------|------|
| `51job-opencli.mjs` | **主采集脚本**。调用 `opencli 51job search`，无需 Hammerspoon/CDP，直接复用 Chrome 登录态。输出格式与旧脚本完全兼容 |
| `51job-rpa-to-pipeline.mjs` | 将 report.json 中的 `dedupJobs` 写入 `data/pipeline.md`，基于 51job URL 去重 |

## 技术说明

`51job-opencli.mjs` 基于 [OpenCLI](https://github.com/jackwener/opencli)：Chrome Browser Bridge extension + 本地 daemon，通过 `withCredentials: true` 的页内 XHR 复用浏览器登录态，无需 Hammerspoon RPA 或 CDP。

## 前置条件

- Chrome 已安装 Browser Bridge 扩展，且已登录 we.51job.com
- OpenCLI daemon 运行中：`opencli daemon start`（首次运行后常驻）

## 用法

```bash
node scrapers/51job/51job-opencli.mjs \
  --query SQE \
  --city 030200 \
  --max-pages 10
```

## 城市码参考（6位，来源：we.51job.com `seo_dd_areas`）

| 城市 | 码 |
|------|----|
| 佛山 | 030600 |
| 广州 | 030200 |
| 深圳 | 040000 |
| 东莞 | 030800 |
| 上海 | 020000 |
| 北京 | 010000 |
| 天津 | 050000 |
| 重庆 | 060000 |
| 南京 | 070200 |
| 苏州 | 070300 |
| 无锡 | 070400 |
| 杭州 | 080200 |
| 宁波 | 080300 |
| 成都 | 090200 |
| 厦门 | 110300 |
| 武汉 | 180200 |
| 长沙 | 190200 |
| 西安 | 200200 |
| 不限 | 000000 |

## 依赖

- OpenCLI
- Chrome Browser Bridge 扩展
- 已登录 we.51job.com 的 Chrome

## 输出

采集结果写入 `output/51job/rpa/{timestamp}-{query}/report.json`，
然后自动追加到 `data/pipeline.md`（除非 `--skip-pipeline`）。
