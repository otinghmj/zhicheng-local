# 猎聘采集参考

## 脚本位置

```
scrapers/liepin/liepin-dom.mjs        ← 主脚本：CDP + DOM 抓取（绕过 API 反爬）
scrapers/liepin/liepin-jd-fetch.mjs   ← JD 详情接口（猎聘独有）
```
> 已退役的 Hammerspoon 备用脚本与旧 API 脚本已迁出，归档在 `<项目外归档目录>/liepin/`。

---

## 接口一：搜索职位列表（CDP-DOM 模式）

```bash
node scrapers/liepin/liepin-dom.mjs \
  --query "<关键词>" \
  --city "<城市码或城市名>" \
  --max-pages <页数> \
  --skip-pipeline
```

`--skip-pipeline` 是接口规范，必须始终携带。

**工作原理：**
- 通过 Chrome CDP（调试端口 9223）在猎聘搜索页导航
- 等待页面渲染后从 DOM 提取职位卡片（`.job-card-pc-container`）
- 完全绕过 api-c.liepin.com 的 security.min.js + acw_tc WAF 反爬
- 每页约 42 条结果，翻页通过 URL 参数 `curPage` 控制

**前置条件：**
- Chrome 已开启 `--remote-debugging-port=9223`
- 用户已在 Chrome 中登录猎聘（匿名也可搜索，但登录后结果更全）

**stdout JSON 关键字段：**
```
dedupCount   去重后职位数
dedupJobs[]  职位数组（jobName / brandName / salaryDesc / cityName / url）
             注意：URL 字段名为 url，不是 jobUrl
reportPath   本地报告路径（可传给 JD 接口）
```

**反爬 & 频率控制：**
- 脚本内置文件锁 + 查询间 3 分钟冷却（与旧 API 脚本共享锁）
- 页间间隔 8-15s（可通过 `SCRAPER_PAGE_PAUSE_MS` / `SCRAPER_PAGE_JITTER_MS` 调整）
- DOM 模式不直接调 API，风控风险远低于旧 API 模式
- 城市参数支持中文名（如 `--city 上海`）和城市码（如 `--city 020`）

---

## 接口二：获取 JD 详情（猎聘独有）

> **⚠️ 反爬说明**：职位详情页对未登录请求返回 302。脚本优先通过 Chrome 调试端口 9223（CDP 模式）利用已登录会话获取内容，CDP 不可用时回退直接 HTTP。若大量 302 失败，提示用户在 Chrome（端口 9223）中登录猎聘后重试。
>
> **频率控制**：批量拉取时建议 `--concurrency 1 --delay 10000`（10s 间隔），避免触发 429。

**单条 URL：**
```bash
node scrapers/liepin/liepin-jd-fetch.mjs --url <liepin职位URL>
```

**从报告批量拉取（接口一返回的 reportPath）：**
```bash
node scrapers/liepin/liepin-jd-fetch.mjs \
  --report <report.json路径> \
  [--concurrency 2] \
  [--delay 1500]
```

**新增字段：**
```
jd            完整职位描述正文
department    所属部门
companyIntro  公司简介
```

**返回**：富化后的职位数组，成功数/失败数统计。失败率 >50% 时提示登录 Chrome。

---

## 城市码（常用）

完整列表：`node scrapers/shared/city-codes.mjs get liepin <城市名>`

支持直接传中文城市名（脚本内置映射），也可传猎聘城市码：

| 城市 | 码 | 城市 | 码 |
|------|----|------|----|
| 全国 | 410 | 北京 | 010 |
| 上海 | 020 | 广州 | 050020 |
| 深圳 | 050090 | 杭州 | 070020 |
| 成都 | 090020 | 武汉 | 180020 |
| 西安 | 200010 | 南京 | 060020 |
| 重庆 | 030 | 天津 | 040 |
| 苏州 | 060090 | 厦门 | 110030 |
