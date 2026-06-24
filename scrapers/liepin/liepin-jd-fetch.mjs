#!/usr/bin/env node
// 猎聘职位详情（JD）采集模块
//
// 用法（CLI）：
//   # 单条 URL
//   node scrapers/liepin/liepin-jd-fetch.mjs --url https://www.liepin.com/job/1978071197.shtml
//
//   # 从 report.json 批量拉取（读取 dedupJobs 列表）
//   node scrapers/liepin/liepin-jd-fetch.mjs --report output/liepin/api/xxx/report.json
//
//   # 批量 + 写入 report 同目录的 jd-report.json
//   node scrapers/liepin/liepin-jd-fetch.mjs --report output/liepin/api/xxx/report.json --out-dir output/liepin/api/xxx
//
//   # 控制并发和间隔
//   node scrapers/liepin/liepin-jd-fetch.mjs --report ... --concurrency 2 --delay 1500
//
// 模块导入：
//   import { fetchJobDetail, fetchJobDetails } from "./liepin-jd-fetch.mjs";
//   const detail = await fetchJobDetail("https://www.liepin.com/job/1978071197.shtml");
//   const results = await fetchJobDetails(["url1", "url2"], { concurrency: 2, delayMs: 1500 });

import fs      from "node:fs/promises";
import path    from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const API_PORT = Number(process.env.BOSS_API_PORT || 3337);
const API_KEY  = String(process.env.BOSS_API_KEY  || "").trim();
const CDP_URL  = String(process.env.BOSS_CDP_URL  || "http://127.0.0.1:9223").trim();

// ── 参数解析 ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    url:         "",
    report:      "",
    outDir:      "",
    concurrency: 1,
    delayMs:     1500,
    skipExisting: true,  // report 模式下跳过已有 jd 字段的条目
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url")          { out.url         = argv[++i] || ""; continue; }
    if (a === "--report")       { out.report      = argv[++i] || ""; continue; }
    if (a === "--out-dir")      { out.outDir      = argv[++i] || ""; continue; }
    if (a === "--concurrency")  { out.concurrency = Number(argv[++i] || "1"); continue; }
    if (a === "--delay")        { out.delayMs     = Number(argv[++i] || "1500"); continue; }
    if (a === "--no-skip")      { out.skipExisting = false; continue; }
    if (a === "--help" || a === "-h") {
      console.log([
        "Usage:",
        "  node liepin-jd-fetch.mjs --url <url>",
        "  node liepin-jd-fetch.mjs --report <report.json> [--out-dir <dir>]",
        "                           [--concurrency 2] [--delay 1500] [--no-skip]",
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

// ── API 服务器管理 ─────────────────────────────────────────────────────────────
const _children = new Set();
process.on("SIGINT",  () => { for (const c of _children) try { c.kill(); } catch {} process.exit(130); });
process.on("SIGTERM", () => { for (const c of _children) try { c.kill(); } catch {} process.exit(143); });

const apiHdr = () => ({
  "Content-Type": "application/json",
  ...(API_KEY ? { "x-api-key": API_KEY } : {}),
});

async function checkApiHealth(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: apiHdr() });
    return (await r.json())?.ok === true;
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
    BOSS_API_PORT:               String(port),
    BOSS_API_RATE_LIMIT_MAX_REQ: "200",
    BOSS_API_INSECURE_TLS:       "1",
  };
  const child = spawn("node", [path.resolve("scrapers/shared/api-server.mjs")], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  _children.add(child);
  child.stdout.on("data", (c) => process.stderr.write(c));
  child.stderr.on("data", (c) => process.stderr.write(c));
  return child;
}

// ── 核心：单条详情拉取 ────────────────────────────────────────────────────────
/**
 * 从 API server 拉取单条职位详情
 * 优先使用 CDP 模式（绕过猎聘 302 反爬），失败时回退直接 HTTP 模式
 * @param {string} url  猎聘职位页 URL，如 https://www.liepin.com/job/1978071197.shtml
 * @returns {Promise<Object>}  { ok, url, jobName, brandName, salaryDesc, cityName,
 *                               jobExperience, jobDegree, brandIndustry, brandScaleName,
 *                               department, jd, companyIntro, error? }
 */
export async function fetchJobDetail(url) {
  // 先尝试 CDP 模式（需要 Chrome 调试端口）
  try {
    const cdpRes = await fetch(`http://127.0.0.1:${API_PORT}/api/liepin/job/detail/cdp`, {
      method:  "POST",
      headers: apiHdr(),
      body:    JSON.stringify({ url, cdpUrl: CDP_URL }),
    });
    if (cdpRes.ok) {
      const data = await cdpRes.json();
      if (data.ok) return data;
    }
  } catch {
    // CDP 不可用，继续尝试直接 HTTP
  }

  // 回退：直接 HTTP 模式
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/liepin/job/detail`, {
    method:  "POST",
    headers: apiHdr(),
    body:    JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error(`detail HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

// ── 批量拉取（限并发 + 间隔）────────────────────────────────────────────────
/**
 * 批量拉取职位详情
 * @param {string[]} urls
 * @param {{ concurrency?: number, delayMs?: number,
 *           onProgress?: (done, total, result) => void }} opts
 * @returns {Promise<Object[]>}
 */
export async function fetchJobDetails(urls, opts = {}) {
  const { concurrency = 1, delayMs = 1500, onProgress } = opts;
  const results = new Array(urls.length).fill(null);
  let idx = 0;

  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      const url = urls[i];
      try {
        if (i > 0) await sleep(delayMs + Math.random() * 500);
        const detail = await fetchJobDetail(url);
        results[i] = detail;
        onProgress?.(i + 1, urls.length, detail);
      } catch (err) {
        results[i] = { ok: false, url, error: err.message };
        onProgress?.(i + 1, urls.length, results[i]);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}

// ── 主流程（CLI 用） ──────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 确保 API server 运行
  let ownedServer = null;
  if (!await checkApiHealth(API_PORT)) {
    console.error(`[liepin-jd-fetch] 启动 api-server port=${API_PORT}...`);
    ownedServer = spawnApiServer(API_PORT);
    if (!await waitForApi(API_PORT, 12000)) {
      console.error("[liepin-jd-fetch] API server 未就绪，退出");
      process.exit(1);
    }
  } else {
    console.error(`[liepin-jd-fetch] API server 已就绪 port=${API_PORT}`);
  }

  // ── 模式 A：单条 URL ────────────────────────────────────────────────────────
  if (opts.url) {
    console.error(`[liepin-jd-fetch] 拉取: ${opts.url}`);
    const detail = await fetchJobDetail(opts.url);
    console.log(JSON.stringify(detail, null, 2));
    if (ownedServer) ownedServer.kill("SIGTERM");
    return;
  }

  // ── 模式 B：从 report.json 批量拉取 ─────────────────────────────────────────
  if (opts.report) {
    const reportPath = path.resolve(opts.report);
    let report;
    try {
      report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    } catch (err) {
      console.error(`[liepin-jd-fetch] 读取 report 失败: ${err.message}`);
      process.exit(1);
    }

    const jobs = Array.isArray(report.dedupJobs) ? report.dedupJobs : [];
    if (jobs.length === 0) {
      console.error("[liepin-jd-fetch] report.dedupJobs 为空，无可拉取");
      process.exit(0);
    }

    // 过滤：跳过已有 jd 字段的条目（除非 --no-skip）
    const targets = opts.skipExisting
      ? jobs.filter(j => !j.jd)
      : jobs;

    console.error(`[liepin-jd-fetch] 共 ${jobs.length} 条，需拉取 ${targets.length} 条` +
      (opts.skipExisting && targets.length < jobs.length
        ? `（跳过 ${jobs.length - targets.length} 条已有JD）`
        : ""));

    if (targets.length === 0) {
      console.error("[liepin-jd-fetch] 全部已有JD，无需重复拉取");
      if (ownedServer) ownedServer.kill("SIGTERM");
      return;
    }

    // 拉取
    const details = await fetchJobDetails(
      targets.map(j => j.url),
      {
        concurrency: opts.concurrency,
        delayMs:     opts.delayMs,
        onProgress: (done, total, r) => {
          const status = r.ok ? `✓ ${r.jobName || r.url}` : `✗ ${r.error}`;
          console.error(`[liepin-jd-fetch] [${done}/${total}] ${status}`);
        },
      }
    );

    // 合并回 jobs（按 url 匹配）
    const detailMap = new Map(details.map(d => [d.url, d]));
    let enriched = 0;
    const enrichedJobs = jobs.map(j => {
      const d = detailMap.get(j.url);
      if (!d?.ok) return j;
      enriched++;
      return {
        ...j,
        jd:           d.jd           || j.jd           || "",
        department:   d.department   || j.department   || "",
        companyIntro: d.companyIntro || j.companyIntro || "",
        brandIndustry: d.brandIndustry || j.brandIndustry || "",
        brandScaleName: d.brandScaleName || j.brandScaleName || "",
      };
    });

    const successCount = details.filter(d => d.ok).length;
    const failCount    = details.length - successCount;

    // 写输出
    const outDir = opts.outDir
      ? path.resolve(opts.outDir)
      : path.dirname(reportPath);
    await fs.mkdir(outDir, { recursive: true });
    const jdReportPath = path.join(outDir, "jd-report.json");
    const jdReport = {
      ...report,
      dedupJobs: enrichedJobs,
      jdFetchedAt:   new Date().toISOString(),
      jdFetchCount:  enriched,
      jdFailCount:   failCount,
    };
    await fs.writeFile(jdReportPath, JSON.stringify(jdReport, null, 2), "utf8");

    const summary = {
      ok:          true,
      source:      "liepin",
      mode:        "jd-batch",
      total:       jobs.length,
      fetched:     successCount,
      skipped:     jobs.length - targets.length,
      failed:      failCount,
      enriched,
      jdReportPath,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (ownedServer) ownedServer.kill("SIGTERM");
    return;
  }

  // 未指定任何输入
  console.error("[liepin-jd-fetch] 请指定 --url 或 --report，使用 --help 查看用法");
  if (ownedServer) ownedServer.kill("SIGTERM");
  process.exit(1);
}

// 只在直接运行时执行 main（不影响 import 使用）
import { fileURLToPath } from "node:url";
const _thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(_thisFile)) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}
