# zhaopin — 智联招聘采集模块

## 文件组成

| 文件 | 原始行数 | 职责 |
|------|----------|------|
| `zhaopin-hs-rpa.mjs` | 310 | 智联主采集编排器。4 阶段流程：① 启动 shared/api-server → ② Hammerspoon 导航到搜索结果页触发 cookies/登录态 → ③ CDP 读取 `window.__INITIAL_STATE__.positionList`（首页） → ④ CDP `Page.navigate` 翻页逐页提取 → 写入 pipeline.md |
| `zhaopin-jd-fetch.mjs` | 347 | JD 详情采集模块。CDP 直连调试 Chrome（port 9223），为每条 URL 创建独立标签页，提取 JD 正文及结构化字段（薪资/学历/经验/公司介绍/工作地址），支持单条 URL 和从 report.json 批量拉取 |
| `tools/zhaopin_hammerspoon_rpa.lua` | 219 | macOS Hammerspoon RPA，职责单一：导航到智联搜索结果页、等待首次 XHR 响应触发后退出。翻页完全由 zhaopin-hs-rpa.mjs 通过 CDP replay 完成，Lua 不参与翻页 |

## 历史采集记录

`output/zhaopin/rpa/` 下已有 5 次采集输出。

## 依赖

- `scrapers/shared/api-server.mjs`（复用同一服务，端口 3337）
- Hammerspoon（macOS 必需，仅 zhaopin-hs-rpa.mjs 使用）
- 调试 Chrome（port 9223，两个脚本均使用）

## 常用参数

```bash
# 列表采集
node scrapers/zhaopin/zhaopin-hs-rpa.mjs \
  --query SQE \
  --city 763 \
  --max-pages 10

# JD 详情 — 单条
node scrapers/zhaopin/zhaopin-jd-fetch.mjs \
  --url https://www.zhaopin.com/jobdetail/xxx.htm

# JD 详情 — 从 report.json 批量拉取（跳过已有JD，间隔4s）
node scrapers/zhaopin/zhaopin-jd-fetch.mjs \
  --report output/zhaopin/rpa/xxx/report.json \
  --delay 4
```

## 城市码参考

> **完整列表见** `scrapers/shared/city-codes.json`（487个城市）
> 查询工具：`node scrapers/shared/city-codes.mjs get zhaopin 佛山`

| 城市 | 码 |
|------|----|
| 佛山 | 768 |
| 广州 | 763 |
| 深圳 | 765 |
| 东莞 | 779 |
| 上海 | 538 |
| 北京 | 530 |
| 天津 | 531 |
| 重庆 | 551 |
| 南京 | 635 |
| 苏州 | 639 |
| 无锡 | 636 |
| 杭州 | 653 |
| 宁波 | 654 |
| 成都 | 801 |
| 厦门 | 682 |
| 武汉 | 736 |
| 长沙 | 749 |
| 西安 | 854 |
| 全国 | 489 |
