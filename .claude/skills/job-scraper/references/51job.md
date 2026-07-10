# 前程无忧采集参考

## 脚本位置

```
scrapers/51job/51job-opencli.mjs          ← 主采集脚本：OpenCLI 模式（无需 Hammerspoon）
scrapers/51job/51job-rpa-to-pipeline.mjs  ← 将 report.json 写入 pipeline（按需）
```
> 已退役的 Hammerspoon 脚本已迁出，归档在 `<项目外归档目录>/51job/`。

> **⚠️ 前置条件**：
> - Chrome 已安装 OpenCLI Browser Bridge 扩展，且已登录 we.51job.com
> - OpenCLI daemon 运行中（首次运行后常驻）：`opencli daemon start`
>
> **采集特性**：OpenCLI 内置 Aliyun WAF bypass，经 3 轮稳定性测试验证，salary 填充率 100%，无风控信号，平均采集耗时 ~7s/30条。

---

## 接口：搜索职位列表

```bash
node scrapers/51job/51job-opencli.mjs \
  --query "<关键词>" \
  --city "<城市码>" \
  --max-pages <页数> \
  [--skip-pipeline]
```

**采集流程**：
1. 将 51job 城市码映射为中文城市名
2. 调用 `opencli 51job search <query> --area <城市> --limit <max-pages×30> --format json`
3. 字段映射到 pipeline schema，写 report.json

**stdout 关键字段：**
```
dedupJobs[]  去重后职位数组（jobName / brandName / salaryDesc / cityName / url / encryptJobId）
             url 字段是职位链接（jobs.51job.com/...），可直接用于 JD 详情
reportPath   本地报告路径（output/51job/rpa/{timestamp}-{query}/report.json）
```

---

## 接口：获取 JD 详情

> **⚠️ 前置条件**：
> - 前程无忧搜索结果页必须在 Chrome 中**已打开**（JD 详情通过模拟点击搜索卡片触发新 tab 实现）
> - api-server 必须运行（脚本启动时自动启动，端口 3337）
> - `jobId` 来自搜索结果的 `dedupJobs[].jobId` 字段

**技术原理**：51job 是 Vue SPA，职位详情通过 `window.open()` 在新 tab 中打开 `jobs.51job.com` 页面。
详情接口通过 CDP 在 Chrome 中找到搜索结果卡片，点击职位标题触发新 tab，从新 tab 的 `.bmsg` 元素提取完整 JD，提取后关闭新 tab。

**通过 api-server HTTP 接口调用（用于集成）：**
```bash
curl -X POST http://127.0.0.1:3337/api/51job/job/detail \
  -H "Content-Type: application/json" \
  -d '{"jobId": "<来自搜索结果的jobId>"}'
```

**返回字段：**
```
ok         是否成功
jobName    职位标题
brandName  公司名称
salaryDesc 薪资描述
cityName   城市/经验/学历信息
jd         完整职位描述正文（主要字段）
jobId      职位 ID
source     固定为 "click-new-tab"
```

---

## 城市码（常用）

完整列表：`node scrapers/shared/city-codes.mjs get 51job <城市名>`

注意：前程无忧使用 6 位城市码。

| 城市 | 码 | 城市 | 码 |
|------|----|------|----|
| 全国 | 000000 | 北京 | 010000 |
| 上海 | 020000 | 广州 | 030200 |
| 深圳 | 040000 | 杭州 | 080200 |
| 成都 | 090200 | 武汉 | 180200 |
| 西安 | 200200 | 南京 | 070200 |
| 重庆 | 060000 | 天津 | 050000 |
| 苏州 | 070300 | 厦门 | 110300 |
| 佛山 | 030600 | 东莞 | 030800 |
