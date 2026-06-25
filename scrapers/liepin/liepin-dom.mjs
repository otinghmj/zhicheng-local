#!/usr/bin/env node
// 猎聘 DOM 抓取采集脚本（替代已失效的 API 模式）
//
// 原理：
//   通过 Chrome CDP 在猎聘搜索页导航 → 等待页面渲染 → 从 DOM 提取职位卡片
//   完全绕过 api-c.liepin.com 的 -1400 security.min.js 反爬
//
// 流程：
//   Phase 0  确保 Chrome 调试端口可用 + 猎聘已登录
//   Phase 1  CDP 打开搜索页，逐页 DOM 抓取
//   Phase 2  整合去重 + 写 report.json
//   Phase 3  写 pipeline.md（除非 --skip-pipeline）
//
// 用法：
//   node scrapers/liepin/liepin-dom.mjs [--query SQE] [--city 010] [--max-pages 10] [--skip-pipeline]
//
// 优势（对比旧 liepin-api.mjs）：
//   - 不依赖额外 API 中间层
//   - 绕过 security.min.js + acw_tc WAF 对 API 的拦截
//   - 利用 Chrome 已登录状态，无需单独管理 cookie
//
// 依赖：
//   - Chrome 开启 --remote-debugging-port=9223
//   - 用户已在 Chrome 中登录猎聘

import fs      from "node:fs/promises";
import fsSync  from "node:fs";
import path    from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { getCity } from "../shared/city-codes.mjs";
import { ensureChrome } from "../shared/ensure-chrome.mjs";

let CDP_URL = String(process.env.CDP_URL || process.env.BOSS_CDP_URL || "http://127.0.0.1:9223");

function resolveCity(input) {
  if (!input) return '410';
  if (/^\d+$/.test(input)) return input;
  const cityCode = getCity('liepin', input);
  if (cityCode) return cityCode;
  throw new Error(`未知猎聘城市：${input}。请运行 node scrapers/shared/city-codes.mjs search liepin <城市名> 查询。`);
}

// ── 并发防护：文件锁 + 查询间冷却（与 liepin-api.mjs 共享同一把锁） ────────────
const LOCK_FILE       = path.resolve("output/liepin/api/.lock");
const COOLDOWN_FILE   = path.resolve("output/liepin/api/.last-query-ts");
const INTER_QUERY_MS  = Number(process.env.LIEPIN_INTER_QUERY_MS   || 180_000);
const PAGE_PAUSE_MS   = Number(process.env.SCRAPER_PAGE_PAUSE_MS   ||   8_000);
const PAGE_JITTER_MS  = Number(process.env.SCRAPER_PAGE_JITTER_MS  ||   7_000);
const LOCK_TIMEOUT_MS = Number(process.env.LIEPIN_LOCK_TIMEOUT_MS  || 600_000);

async function acquireLock(query) {
  await fs.mkdir(path.dirname(LOCK_FILE), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const fh = await fs.open(LOCK_FILE, "wx");
      await fh.writeFile(JSON.stringify({ pid: process.pid, lockedAt: Date.now(), query }), "utf8");
      await fh.close();
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const { pid, lockedAt, query: heldBy } = JSON.parse(await fs.readFile(LOCK_FILE, "utf8"));
        let alive = false;
        try { process.kill(pid, 0); alive = true; } catch {}
        if (alive) {
          const secs = ((Date.now() - lockedAt) / 1000).toFixed(0);
          console.error(`[liepin-dom] ⏳ 等待锁释放（PID=${pid} 正在搜索"${heldBy}"，已${secs}s）...`);
          await sleep(3000);
        } else {
          console.error(`[liepin-dom] 🔓 过期锁（PID=${pid}已退出），强制清除`);
          try { await fs.unlink(LOCK_FILE); } catch {}
        }
      } catch {
        try { await fs.unlink(LOCK_FILE); } catch {}
      }
    }
  }
  throw new Error(`获取猎聘搜索锁超时（>${LOCK_TIMEOUT_MS/1000}s）：${LOCK_FILE}`);
}

async function releaseLock() {
  try { await fs.unlink(LOCK_FILE); } catch {}
  await fs.writeFile(COOLDOWN_FILE, String(Date.now()), "utf8").catch(() => {});
}

function releaseLockSync() {
  try { fsSync.unlinkSync(LOCK_FILE); } catch {}
  try { fsSync.writeFileSync(COOLDOWN_FILE, String(Date.now()), "utf8"); } catch {}
}

async function waitCooldown() {
  try {
    const last = parseInt(await fs.readFile(COOLDOWN_FILE, "utf8"), 10);
    const elapsed = Date.now() - last;
    if (elapsed < INTER_QUERY_MS) {
      const wait = INTER_QUERY_MS - elapsed;
      console.error(`[liepin-dom] ❄️  冷却 ${(wait/1000).toFixed(1)}s...`);
      await sleep(wait);
    }
  } catch {}
}

// ── CDP 工具函数 ─────────────────────────────────────────────────────────────
let _cdpId = 1;
function cdpWsCall(wsUrl, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = _cdpId++;
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id, method, params })));
    ws.addEventListener("message", ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    ws.addEventListener("error", (e) => reject(new Error(`CDP WS error: ${e.message || e}`)));
    setTimeout(() => { ws.close(); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
  });
}

async function getPages(cdpUrl) {
  const pages = await fetch(`${cdpUrl}/json`).then(r => r.json()).catch(() => []);
  return pages.filter(p => p.type === "page");
}

/** 在指定 tab 上执行 JS，返回值 */
async function evalInPage(wsUrl, script, timeoutMs = 15000) {
  const result = await cdpWsCall(wsUrl, "Runtime.evaluate", {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  }, timeoutMs + 2000);
  return result?.result?.value ?? null;
}

/**
 * 导航到 URL 并等待页面就绪。
 * 关键发现：Page.navigate 后必须等 ~8s 才能在新页面上 eval。
 * 在此期间旧 execution context 已销毁，新的要等页面完全加载。
 */
async function navigateAndWait(wsUrl, url, waitMs = 8000) {
  // 发送 Page.navigate 并等待响应确认
  await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } }));
    });
    ws.addEventListener("message", () => { ws.close(); resolve(); });
    ws.addEventListener("error", () => resolve());
    setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 5000);
  });

  // 固定等待——导航后 context 销毁再重建需要时间
  await sleep(waitMs);
}

/** 找到或创建猎聘相关的 tab，返回 { targetId, wsUrl } */
async function findOrCreateLiepinTab(cdpUrl) {
  const pages = await getPages(cdpUrl);
  // 优先找已在猎聘的 tab
  const liepinTab = pages.find(p => p.url && p.url.includes("liepin.com"));
  if (liepinTab?.webSocketDebuggerUrl) {
    console.error(`[liepin-dom] 📄 复用已有猎聘 tab: ${liepinTab.url.slice(0, 60)}`);
    return { targetId: liepinTab.id, wsUrl: liepinTab.webSocketDebuggerUrl };
  }
  // 找一个空白 tab 或创建新 tab
  const blankTab = pages.find(p => p.url === "about:blank" || p.url === "chrome://newtab/");
  if (blankTab?.webSocketDebuggerUrl) {
    console.error("[liepin-dom] 📄 使用空白 tab");
    return { targetId: blankTab.id, wsUrl: blankTab.webSocketDebuggerUrl };
  }
  // 创建新 tab
  const version = await fetch(`${cdpUrl}/json/version`).then(r => r.json());
  const bws = version.webSocketDebuggerUrl;
  const result = await cdpWsCall(bws, "Target.createTarget", { url: "about:blank" });
  const targetId = result.targetId;
  await sleep(500);
  const updatedPages = await getPages(cdpUrl);
  const newTab = updatedPages.find(p => p.id === targetId);
  if (!newTab?.webSocketDebuggerUrl) throw new Error("创建新 tab 失败");
  console.error("[liepin-dom] 📄 创建了新 tab");
  return { targetId, wsUrl: newTab.webSocketDebuggerUrl };
}

// ── DOM 抓取脚本（与 opencli 适配器同步） ────────────────────────────────────────

const EXTRACT_SEARCH_DOM = `(() => {
  const cards = document.querySelectorAll('.job-card-pc-container');
  const jobs = [];
  for (const card of cards) {
    const jobLink = card.querySelector('a[data-nick="job-detail-job-info"]');
    const href = jobLink ? jobLink.getAttribute('href') : '';
    const titleEl = card.querySelector('.ellipsis-1[title]');
    const title = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText || '').trim() : '';
    const cleanTitle = title.replace(/^招聘/, '').trim();
    let salary = '';
    for (const s of card.querySelectorAll('span')) {
      const t = s.innerText.trim();
      if (/\\d+.*k/i.test(t) || /\\d+.*万/.test(t) || /面议/.test(t)) { salary = t; break; }
    }
    let city = '';
    for (const s of card.querySelectorAll('.ellipsis-1')) {
      const t = s.innerText.trim();
      if (!s.hasAttribute('title') && t && !(/k|万|面议/.test(t))) { city = t; break; }
    }
    const labelSpans = [...card.querySelectorAll('span')].map(s => s.innerText.trim());
    let experience = '', degree = '';
    for (const t of labelSpans) {
      if (/年|经验不限/.test(t) && !experience) experience = t;
      if (/大专|本科|硕士|博士|学历不限/.test(t) && !degree) degree = t;
    }
    const compBox = card.querySelector('[data-nick="job-detail-company-info"]');
    let company = '', industry = '', companySize = '', companyStage = '';
    if (compBox) {
      const compNameEl = compBox.querySelector('.ellipsis-1');
      company = compNameEl ? compNameEl.innerText.trim() : '';
      const compSpans = [...compBox.querySelectorAll('span')].map(s => s.innerText.trim()).filter(t => t && t !== company && t.length < 30);
      for (const t of compSpans) {
        if (/人$/.test(t)) companySize = t;
        else if (/轮|融资|上市|天使|IPO|不需要|未融资/.test(t)) companyStage = t;
        else if (!industry && t !== company) industry = t;
      }
    }
    const skillEls = card.querySelectorAll('[class*="tag"] span, [class*="label"] span');
    const skills = [...skillEls].map(s => s.innerText.trim()).filter(t => t && t.length < 15 && !/年|大专|本科|硕士|博士|经验|学历|急聘|new/.test(t));
    if (cleanTitle) {
      let fullUrl = '';
      if (href) {
        try { fullUrl = new URL(href, window.location.origin).href.replace(/\\?.*/, ''); } catch { fullUrl = href; }
      }
      jobs.push({
        jobName: cleanTitle, salaryDesc: salary, cityName: city,
        experience, degree, brandName: company, industry, companySize, companyStage,
        skills: skills.join(','), url: fullUrl,
      });
    }
  }
  const pageItems = document.querySelectorAll('.ant-pagination-item');
  let totalPages = 1;
  for (const item of pageItems) {
    const n = parseInt(item.getAttribute('title'));
    if (n > totalPages) totalPages = n;
  }
  const hasNext = !!document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled)');
  return JSON.stringify({ jobs, totalPages, hasNext });
})()`;

// ── 去重 ──────────────────────────────────────────────────────────────────────
function dedup(jobs) {
  const seen = new Set();
  return jobs.filter(j => {
    const key = j.url || `${j.jobName}|${j.salaryDesc}|${j.cityName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── 参数解析 ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { query: "SQE", city: "010", maxPages: 10, skipPipeline: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--query")         { out.query       = argv[++i] || out.query; continue; }
    if (arg === "--city")          { out.city        = argv[++i] || out.city;  continue; }
    if (arg === "--max-pages")     { out.maxPages    = Number(argv[++i] || "10"); continue; }
    if (arg === "--skip-pipeline") { out.skipPipeline = true; continue; }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scrapers/liepin/liepin-dom.mjs [--query SQE] [--city 010] [--max-pages 10] [--skip-pipeline]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cityCode = resolveCity(options.city);

  // ── Phase 0: 确保 Chrome 可用 ─────────────────────────────────────────────
  const activeCdp = await ensureChrome({ scriptName: "liepin-dom", cdpUrl: CDP_URL, exitOnFail: true });
  if (activeCdp) CDP_URL = activeCdp;

  // ── 串行化保障 ─────────────────────────────────────────────────────────────
  await acquireLock(options.query);
  process.on("exit",    releaseLockSync);
  process.on("SIGINT",  () => { releaseLockSync(); process.exit(130); });
  process.on("SIGTERM", () => { releaseLockSync(); process.exit(143); });

  await waitCooldown();
  console.error(`[liepin-dom] 🔒 获锁+冷却完毕，开始搜索："${options.query}" (city=${cityCode})`);

  const outDir  = path.resolve("output/liepin/api", options.query.toLowerCase().replace(/\s+/g, "-"), cityCode);
  const outPath = path.join(outDir, "report.json");
  await fs.mkdir(outDir, { recursive: true });

  // ── Phase 1: CDP DOM 抓取 ─────────────────────────────────────────────────
  const { targetId, wsUrl } = await findOrCreateLiepinTab(CDP_URL);
  const allRawJobs = [];
  let totalPages = 1;

  for (let page = 0; page < options.maxPages; page++) {
    if (page > 0) {
      const pause = PAGE_PAUSE_MS + Math.random() * PAGE_JITTER_MS;
      console.error(`[liepin-dom] ⏳ 页间等待 ${(pause/1000).toFixed(1)}s...`);
      await sleep(pause);
    }

    const searchUrl = `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(options.query)}&dq=${cityCode}&curPage=${page}`;
    console.error(`[liepin-dom] 📄 导航到 p${page}: ${searchUrl}`);
    await navigateAndWait(wsUrl, searchUrl, 5000);

    // 额外等待 JS 渲染完成
    await sleep(2000);

    const rawResult = await evalInPage(wsUrl, EXTRACT_SEARCH_DOM);
    if (!rawResult) {
      console.error(`[liepin-dom] p${page}: DOM 抓取返回空，可能需要登录`);
      break;
    }

    let result;
    try {
      result = JSON.parse(rawResult);
    } catch {
      console.error(`[liepin-dom] p${page}: JSON 解析失败: ${String(rawResult).slice(0, 200)}`);
      break;
    }

    const jobs = result.jobs || [];
    if (jobs.length === 0) {
      console.error(`[liepin-dom] p${page}: 无职位卡片，停止翻页`);
      break;
    }

    allRawJobs.push(...jobs);

    if (page === 0) {
      totalPages = Math.min(options.maxPages, result.totalPages || 1);
      console.error(`[liepin-dom] p0: ${jobs.length} 条 | 共 ${result.totalPages} 页 → 翻至 ${totalPages} 页`);
    } else {
      console.error(`[liepin-dom] p${page}: +${jobs.length} 条（累计 ${allRawJobs.length}）`);
    }

    if (!result.hasNext || page + 1 >= totalPages) {
      console.error(`[liepin-dom] 最后一页（totalPages=${result.totalPages}）`);
      break;
    }
  }

  // ── Phase 2: 整合 + 写报告 ────────────────────────────────────────────────
  const allJobs = dedup(allRawJobs);
  const report = {
    ok:               true,
    query:            options.query,
    city:             cityCode,
    source:           "liepin",
    collectionMethod: "dom",
    rawJobCount:      allRawJobs.length,
    dedupCount:       allJobs.length,
    dedupJobs:        allJobs,
  };

  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify({
    ok:          true,
    source:      "liepin",
    method:      "dom",
    query:       options.query,
    city:        cityCode,
    reportPath:  outPath,
    dedupCount:  allJobs.length,
    rawJobCount: allRawJobs.length,
    dedupJobs:   allJobs,
  }));

  await releaseLock();

  // ── Phase 3: 自动写 pipeline ──────────────────────────────────────────────
  if (!options.skipPipeline && allJobs.length > 0) {
    try {
      const { writeToPipeline } = await import("./liepin-rpa-to-pipeline.mjs");
      const r = await writeToPipeline({ reportPath: outPath });
      console.error(`[liepin-dom] pipeline.md: +${r.added} 新增，${r.skipped} 已存在`);
    } catch (err) {
      console.error(`[liepin-dom] pipeline 写入失败: ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  releaseLockSync();
  process.exit(1);
});
