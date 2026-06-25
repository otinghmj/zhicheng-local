# liepin — 猎聘采集模块

## 文件组成

| 文件 | 职责 |
|------|------|
| `liepin-dom.mjs` | **主入口**。CDP + DOM 抓取模式，通过 Chrome 调试端口导航搜索页并提取 DOM |
| `liepin-rpa-to-pipeline.mjs` | 报告 → pipeline.md 写入器，支持 URL 去重 |

## 快速使用

```bash
# 标准用法：CDP-DOM 模式（需要 Chrome 调试端口 9223）
node scrapers/liepin/liepin-dom.mjs --query "测试工程师" --city 全国 --max-pages 10 --skip-pipeline

# 城市支持中文名或城市码
node scrapers/liepin/liepin-dom.mjs --query SQE --city 上海 --max-pages 5 --skip-pipeline
node scrapers/liepin/liepin-dom.mjs --query SQE --city 020 --max-pages 5 --skip-pipeline

```

## 采集策略（CDP-DOM 模式）

`liepin-dom.mjs` 工作原理：

1. 通过 Chrome CDP（端口 9223）找到或创建猎聘 tab
2. 导航到 `www.liepin.com/zhaopin/?key=xxx&dq=xxx&curPage=N`
3. 等待页面渲染完成（约 8s）
4. 用 `Runtime.evaluate` 从 DOM 提取 `.job-card-pc-container` 职位卡片
5. 翻页通过 URL 参数 `curPage` 控制，Ant Design 分页组件检测 `hasNext`

**特点：**
- 与用户正常浏览行为一致。
- 每页结果数以猎聘页面实际展示为准。
- 字段从页面结构中提取。

**频率控制：**
- 文件锁串行化（与旧 API 脚本共享锁，不会冲突）
- 查询间 3 分钟冷却（`LIEPIN_INTER_QUERY_MS`）
- 页间 8-15s 间隔（`SCRAPER_PAGE_PAUSE_MS` + `SCRAPER_PAGE_JITTER_MS`）

## 依赖

- Chrome 已开启 `--remote-debugging-port=9223`
- 用户已在 Chrome 中登录猎聘（匿名也可搜索，登录后结果更全）
- 不依赖额外 API 服务

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
