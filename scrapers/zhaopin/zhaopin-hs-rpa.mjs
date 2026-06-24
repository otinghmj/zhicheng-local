#!/usr/bin/env node
// 智联招聘 RPA 采集脚本
//
// 流程：
//   Phase 0    启动 boss-api-server（复用同一服务）
//   Phase 1    Hammerspoon 导航到智联搜索结果页（触发 cookies/登录态初始化）
//   Phase 2    CDP Runtime.evaluate 读取 window.__INITIAL_STATE__.positionList（首页）
//   Phase 3    CDP Page.navigate 翻页并逐页提取（无浏览器点击）
//   Phase 4    写 pipeline.md（自动触发，除非 --skip-pipeline）
//
// 用法：
//   node zhaopin-hs-rpa.mjs [--query SQE] [--city 768] [--max-pages 10]
//                            [--skip-pipeline]

import fs      from "node:fs/promises";
import path    from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureChrome } from "../shared/ensure-chrome.mjs";
import { ensureLoggedIn } from "../shared/check-login.mjs";

const API_PORT       = Number(process.env.BOSS_API_PORT        || 3337);
const CDP_URL        = String(process.env.BOSS_CDP_URL         || "http://127.0.0.1:9223");
const API_KEY        = String(process.env.BOSS_API_KEY         || "").trim();
const PAGE_PAUSE_MS  = Number(process.env.SCRAPER_PAGE_PAUSE_MS  ||  8_000); // 页间基础等待（默认8s）
const PAGE_JITTER_MS = Number(process.env.SCRAPER_PAGE_JITTER_MS ||  7_000); // 页间随机抖动上限（默认7s）

// ── 参数解析 ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    query:        "SQE",
    city:         "768",    // 智联城市码（佛山=768；广州=763；深圳=765；东莞=779）完整列表见 scrapers/shared/city-codes.json
    maxPages:     10,
    skipPipeline: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--query")        { out.query       = argv[++i] || out.query;   continue; }
    if (arg === "--city")         { out.city        = argv[++i] || out.city;    continue; }
    if (arg === "--max-pages")    { out.maxPages     = Number(argv[++i] || "10"); continue; }
    if (arg === "--skip-pipeline"){ out.skipPipeline = true; continue; }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node zhaopin-hs-rpa.mjs [--query SQE] [--city 768] [--max-pages 10] [--skip-pipeline]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

// ── 字段归一化（智联 __INITIAL_STATE__.positionList 结构）───────────────────
function slimZhaopinJob(item = {}) {
  // URL 和 ID
  const id = String(item.number || item.jobId || item.jobNumber || "");
  const rawUrl = String(item.positionURL || item.positionUrl || "");
  const url = rawUrl.replace(/^http:/, "https:") ||
    (id ? `https://www.zhaopin.com/jobdetail/${id}.htm` : "");

  // 薪资：salary60 格式最友好（如 "1.5-3万·15薪"），salaryReal 是数字范围
  const salaryDesc = String(item.salary60 || item.salaryReal || item.salary || "");

  // 技能标签：skillLabel 是 [{value:'...'}] 数组
  const skills = Array.isArray(item.skillLabel)
    ? item.skillLabel.map((s) => String(s?.value || s)).filter(Boolean)
    : Array.isArray(item.skills) ? item.skills : [];

  const welfare = Array.isArray(item.welfareLabel)
    ? item.welfareLabel.filter(Boolean)
    : Array.isArray(item.welfare) ? item.welfare : [];

  const labels = Array.isArray(item.searchTagList)
    ? item.searchTagList.filter(Boolean)
    : Array.isArray(item.jobLabels) ? item.jobLabels : [];

  return {
    url,
    encryptJobId:     id,
    jobName:          String(item.name          || item.jobName      || ""),
    brandName:        String(item.companyName   || item.brandName    || ""),
    salaryDesc,
    cityName:         String(item.workCity      || item.cityName     || ""),
    areaDistrict:     String(item.cityDistrict  || item.areaDistrict || ""),
    businessDistrict: String(item.tradingArea   || item.businessDistrict || ""),
    jobExperience:    String(item.workingExp    || item.jobExperience || ""),
    jobDegree:        String(item.education     || item.jobDegree    || ""),
    brandIndustry:    String(item.industryName  || item.brandIndustry || ""),
    brandScaleName:   String(item.companySize   || item.brandScaleName || ""),
    brandStageName:   String(item.financingStage || item.brandStageName || ""),
    skills,
    welfareList: welfare,
    jobLabels:   labels
  };
}

function dedup(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    const key = j.encryptJobId || `${j.jobName}|${j.salaryDesc}|${j.cityName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── 子进程管理 ─────────────────────────────────────────────────────────────────
const _children = new Set();
process.on("SIGINT",  () => { for (const c of _children) try { c.kill(); } catch {} process.exit(130); });
process.on("SIGTERM", () => { for (const c of _children) try { c.kill(); } catch {} process.exit(143); });

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    _children.add(child);
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; process.stdout.write(c); });
    child.stderr.on("data", (c) => { stderr += c; process.stderr.write(c); });
    child.on("error", reject);
    child.on("close", (code) => {
      _children.delete(child);
      if (code !== 0) reject(new Error(`Command failed (${code}): ${stderr || stdout}`));
      else resolve({ stdout, stderr });
    });
  });
}

// ── API 服务器管理 ─────────────────────────────────────────────────────────────
async function checkApiHealth(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`,
      { headers: API_KEY ? { "x-api-key": API_KEY } : {} });
    const d = await res.json();
    return d?.ok === true;
  } catch { return false; }
}

async function waitForApi(port, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkApiHealth(port)) return true;
    await sleep(500);
  }
  return false;
}

function spawnApiServer(port) {
  const env = {
    ...process.env,
    BOSS_API_PORT:                String(port),
    BOSS_CDP_URL:                 CDP_URL,
    BOSS_API_RATE_LIMIT_MAX_REQ:  "200",
  };
  const child = spawn("node", [path.resolve("scrapers/shared/api-server.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (c) => process.stderr.write(c));
  child.stdout.on("data", (c) => process.stderr.write(c));
  return child;
}

// ── CDP getPage 封装 ──────────────────────────────────────────────────────────
const apiHdr = () => ({
  "Content-Type": "application/json",
  ...(API_KEY ? { "x-api-key": API_KEY } : {})
});

async function getPage(pageUrl, timeoutMs = 22000) {
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/zhaopin/search/getPage`, {
    method: "POST",
    headers: apiHdr(),
    body: JSON.stringify({ cdpUrl: CDP_URL, pageUrl: pageUrl || "", timeoutMs })
  });
  if (!res.ok) throw new Error(`getPage HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

// ── 翻页 URL 构建 ──────────────────────────────────────────────────────────────
function nextPageUrl(currentUrl, targetPage) {
  let url;
  try { url = new URL(currentUrl); } catch { return currentUrl; }
  // 路径式 /p1 → /p{N}
  const m = url.pathname.match(/^(.*\/p)(\d+)(\/.*)?$/);
  if (m) { url.pathname = `${m[1]}${targetPage}${m[3] || ""}`; return url.toString(); }
  // Query 式 ?p=N
  if (url.searchParams.has("p")) { url.searchParams.set("p", String(targetPage)); return url.toString(); }
  if (url.searchParams.has("pageNum")) { url.searchParams.set("pageNum", String(targetPage)); return url.toString(); }
  if (url.searchParams.has("page")) { url.searchParams.set("page", String(targetPage)); return url.toString(); }
  url.searchParams.set("p", String(targetPage));
  return url.toString();
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
function printProgress(current, total, found) {
  console.log(`##PROGRESS ${JSON.stringify({ step: "搜索翻页", current, total, found })}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  printProgress(0, options.maxPages, 0);
  const outDir  = path.resolve("output/zhaopin/rpa", options.query.toLowerCase(), String(options.city));
  const outPath = path.join(outDir, "report.json");
  await fs.mkdir(outDir, { recursive: true });

  // ── Pre-flight: 确保使用同一个 Chrome（普通 Chrome + debug port）─────────────
  await ensureChrome({ scriptName: "zhaopin-hs-rpa", autoKillDebug: true });

  // ── Pre-flight: 检查智联招聘登录状态 ──────────────────────────────────────────
  // skipVerify=true：at/rt cookie 存在即视为已登录，跳过浏览器内 API 验证
  // 智联 API /api/user/baseInfo 在某些场景下返回非 200，导致误判未登录
  await ensureLoggedIn("zhaopin", { cdpUrl: CDP_URL, scriptName: "zhaopin-hs-rpa", skipVerify: true });

  // ── Phase 0: 确保 API 服务器运行 ────────────────────────────────────────────
  let ownedServer = null;
  if (!await checkApiHealth(API_PORT)) {
    console.error(`[zhaopin-hs-rpa] 启动 boss-api-server port=${API_PORT}...`);
    ownedServer = spawnApiServer(API_PORT);
    _children.add(ownedServer);
    if (!await waitForApi(API_PORT, 12000)) {
      console.error("[zhaopin-hs-rpa] API server 12s 内未就绪，继续尝试...");
    }
  } else {
    console.error(`[zhaopin-hs-rpa] API server 已就绪 port=${API_PORT}`);
  }

  // ── Phase 1: Hammerspoon 导航（确保登录态/Cookie 有效）─────────────────────
  const luaPath  = path.resolve("scrapers/zhaopin/tools/zhaopin_hammerspoon_rpa.lua");
  // _cli 是 Hammerspoon 保护名，顶层赋值 exit 65；改用 _hs_args 在 timer 回调内设置
  const argsInner = `_hs_args = { args = { "--query", ${JSON.stringify(options.query)}, "--city", ${JSON.stringify(options.city)}, "--out", ${JSON.stringify(outPath)} } }; dofile(${JSON.stringify(luaPath)})`;
  const hsCode   = `hs.timer.doAfter(0, function() ${argsInner} end)`;
  const hsArgs   = ["-t", "10", "-c", hsCode];
  let hsReport   = {};
  let hsError    = null;

  try {
    await runCommand("hs", hsArgs, process.cwd());
  } catch (err) {
    const msg = err.message || "";
    const isReceiveTimeout = msg.includes("receive timeout") || msg.includes("(69)");
    const isSendTimeout    = msg.includes("send timeout");
    if (isReceiveTimeout && !isSendTimeout) {
      console.error(`[zhaopin-hs-rpa] Hammerspoon timer scheduled (IPC receive timeout expected for async timer), polling for report...`);
    } else {
      hsError = msg;
      console.error(`[zhaopin-hs-rpa] Hammerspoon 错误: ${hsError}`);
    }
  }
  try { hsReport = JSON.parse(await fs.readFile(outPath, "utf8")); } catch {}

  // ── Phase 2: 读取首页职位（CDP Runtime.evaluate，不再重新导航）──────────────
  // hs 已将页面导航到搜索结果，直接从当前页提取 __INITIAL_STATE__
  const allRawJobs = [];
  let totalPages   = 1;
  let currentUrl   = hsReport?.finalUrl || "";

  if (await checkApiHealth(API_PORT)) {
    try {
      const page1 = await getPage("", 22000); // 不传 pageUrl = 提取当前页状态
      if (page1?.ok && Array.isArray(page1.positionList) && page1.positionList.length > 0) {
        allRawJobs.push(...page1.positionList);
        const serverPages = Number(page1.pages) || 1;
        totalPages  = Math.min(options.maxPages, serverPages);
        currentUrl  = page1.currentUrl || currentUrl;
        console.error(`[zhaopin-hs-rpa] 首页: ${page1.positionList.length} 条 | 共 ${page1.positionCount} 条 | ${serverPages} 页（翻至 ${totalPages} 页）`);
        printProgress(1, totalPages, allRawJobs.length);
      } else {
        console.error(`[zhaopin-hs-rpa] 首页提取失败: ${JSON.stringify(page1)}`);
      }
    } catch (err) {
      console.error(`[zhaopin-hs-rpa] 首页提取异常: ${err.message}`);
    }
  }

  // ── Phase 3: CDP 翻页（Page.navigate + 提取）────────────────────────────────
  if (currentUrl && totalPages > 1) {
    for (let page = 2; page <= totalPages; page++) {
      try {
        await sleep(PAGE_PAUSE_MS + Math.random() * PAGE_JITTER_MS); // 礼貌间隔
        const pageUrl = nextPageUrl(currentUrl, page);
        const result  = await getPage(pageUrl, 22000);
        if (result?.ok && Array.isArray(result.positionList) && result.positionList.length > 0) {
          allRawJobs.push(...result.positionList);
          currentUrl = result.currentUrl || pageUrl;
          console.error(`[zhaopin-hs-rpa] p${page}: +${result.positionList.length} 条（累计 ${allRawJobs.length}）`);
          printProgress(page, totalPages, allRawJobs.length);
        } else {
          console.error(`[zhaopin-hs-rpa] p${page}: 无数据，停止翻页`);
          break;
        }
      } catch (err) {
        console.error(`[zhaopin-hs-rpa] p${page} 翻页失败: ${err.message}，停止翻页`);
        break;
      }
    }
  }

  // ── Phase 4: 整合 + 写报告 ───────────────────────────────────────────────────
  const allJobs = dedup(allRawJobs.map(slimZhaopinJob));

  const finalReport = {
    ...hsReport,
    ok:               !hsError,
    hsError:          hsError || undefined,
    query:            options.query,
    city:             options.city,
    source:           "zhaopin",
    collectionMethod: "cdp-js-state",
    rawJobCount:      allRawJobs.length,
    dedupJobs:        allJobs,
    dedupCount:       allJobs.length
  };

  await fs.writeFile(outPath, JSON.stringify(finalReport, null, 2), "utf8");

  printProgress(totalPages, totalPages, allJobs.length);
  console.log(JSON.stringify({
    ok:          !hsError,
    source:      "zhaopin",
    query:       options.query,
    reportPath:  outPath,
    dedupCount:  allJobs.length,
    rawJobCount: allRawJobs.length,
    dedupJobs:   allJobs,
  }, null, 2));

  if (ownedServer) ownedServer.kill("SIGTERM");

  // ── 自动写 pipeline ────────────────────────────────────────────────────────
  if (!options.skipPipeline && allJobs.length > 0) {
    try {
      const { writeToPipeline } = await import("./boss-rpa-to-pipeline.mjs");
      const r = await writeToPipeline({ reportPath: outPath });
      console.error(`[zhaopin-hs-rpa] pipeline.md: +${r.added} 新增，${r.skipped} 已存在`);
    } catch (err) {
      console.error(`[zhaopin-hs-rpa] pipeline 写入失败: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
  process.exit(1);
});
