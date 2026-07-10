# liepin — 猎聘采集模块

## 文件组成

| 文件 | 职责 |
|------|------|
| `liepin-dom.mjs` | **主入口**。CDP + DOM 抓取模式，通过 Chrome 调试端口导航搜索页并提取 DOM |
| `liepin-jd-fetch.mjs` | **职位详情（JD）采集模块**。可单条拉取或从 report.json 批量富化 |
| `liepin-rpa-to-pipeline.mjs` | 报告 → pipeline.md 写入器，支持 URL 去重 |

> 已退役的 Hammerspoon 备用脚本（`liepin-hs-rpa.mjs`、`liepin_hammerspoon_rpa.lua`）与旧 API 脚本（`liepin-api.mjs`）已迁出本工具，归档在 `<项目外归档目录>/liepin/`。

## 快速使用

```bash
# 标准用法：CDP-DOM 模式（需要 Chrome 调试端口 9223）
node scrapers/liepin/liepin-dom.mjs --query "测试工程师" --city 全国 --max-pages 10 --skip-pipeline

# 城市支持中文名或城市码
node scrapers/liepin/liepin-dom.mjs --query SQE --city 上海 --max-pages 5 --skip-pipeline
node scrapers/liepin/liepin-dom.mjs --query SQE --city 020 --max-pages 5 --skip-pipeline

# 拉取单条职位详情 JD
node scrapers/liepin/liepin-jd-fetch.mjs --url https://www.liepin.com/job/1978071197.shtml

# 从采集报告批量富化 JD
node scrapers/liepin/liepin-jd-fetch.mjs --report output/liepin/api/xxx/report.json \
  --concurrency 1 --delay 10000
```

## 采集策略（CDP-DOM 模式）

`liepin-dom.mjs` 工作原理：

1. 通过 Chrome CDP（端口 9223）找到或创建猎聘 tab
2. 导航到 `www.liepin.com/zhaopin/?key=xxx&dq=xxx&curPage=N`
3. 等待页面渲染完成（约 8s）
4. 用 `Runtime.evaluate` 从 DOM 提取 `.job-card-pc-container` 职位卡片
5. 翻页通过 URL 参数 `curPage` 控制，Ant Design 分页组件检测 `hasNext`

**优势：**
- 完全绕过 api-c.liepin.com 的 security.min.js 浏览器指纹检测 + acw_tc WAF
- 与用户正常浏览行为一致，风控风险极低
- 每页约 42 条结果，字段从 DOM 提取

**频率控制：**
- 文件锁串行化（与旧 API 脚本共享锁，不会冲突）
- 查询间 3 分钟冷却（`LIEPIN_INTER_QUERY_MS`）
- 页间 8-15s 间隔（`SCRAPER_PAGE_PAUSE_MS` + `SCRAPER_PAGE_JITTER_MS`）

## 依赖

- Chrome 已开启 `--remote-debugging-port=9223`
- 用户已在 Chrome 中登录猎聘（匿名也可搜索，登录后结果更全）
- 不再依赖 api-server.mjs

## 输出

```
output/liepin/api/{query}/{cityCode}/report.json
```

输出字段：

```json
{
  "url": "https://www.liepin.com/job/1978071197.shtml",
  "jobName": "质量工程师（产品）",
  "brandName": "华大电子",
  "salaryDesc": "18-22k·14薪",
  "cityName": "北京-昌平区",
  "experience": "5-10年",
  "degree": "本科",
  "industry": "电子/半导体/集成电路",
  "companySize": "100-499人",
  "companyStage": "",
  "skills": ""
}
```
