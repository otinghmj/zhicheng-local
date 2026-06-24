#!/usr/bin/env node
// 智联招聘职位详情（JD）采集模块
//
// 工作原理：直接通过 CDP 导航到详情页，提取 DOM 中的 JD 正文和结构化字段。
// 无需 api-server，复用已登录的调试 Chrome（port 9223）。
//
// 用法：
//   # 单条 URL
//   node scrapers/zhaopin/zhaopin-jd-fetch.mjs --url https://www.zhaopin.com/jobdetail/xxx.htm
//
//   # 从 report.json 批量拉取（读取 dedupJobs 列表）
//   node scrapers/zhaopin/zhaopin-jd-fetch.mjs --report output/zhaopin/rpa/xxx/report.json
//
//   # 控制间隔（秒）
//   node scrapers/zhaopin/zhaopin-jd-fetch.mjs --report ... --delay 4
//
// 模块导入：
//   import { fetchJobDetail, fetchJobDetails } from "./zhaopin-jd-fetch.mjs";

import fs      from "node:fs/promises";
import path    from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureChrome } from "../shared/ensure-chrome.mjs";
import { ensureLoggedIn } from "../shared/check-login.mjs";

const CDP_BASE = String(process.env.BOSS_CDP_URL || "http://127.0.0.1:9223").trim();

// ── DOM 提取脚本（在浏览器内执行）────────────────────────────────────────────
const EXTRACT_SCRIPT = `
(() => {
  const txt = sel => (document.querySelector(sel)?.innerText ?? "").trim();

  // 解析 summary-planes__info："广州 越秀区 / 黄花岗 / 经验不限 / 本科 / 全职 / 招1人"
  const infoRaw = txt(".summary-planes__info");
  const infoParts = infoRaw.split(/[/／]/).map(s => s.trim()).filter(Boolean);

  // 城市取第一段（"广州 越秀区" 或 "广州"），经验/学历按关键词匹配
  const cityRaw   = infoParts[0] ?? "";
  const expPart   = infoParts.find(s => /年|经验|应届/.test(s)) ?? "";
  const degreePart= infoParts.find(s => /本科|大专|硕士|博士|高中|不限/.test(s)) ?? "";

  // 公司描述拆分："未融资 · 500-999人 · 检测/认证/计量"
  const compDesc  = txt(".company-info__desc");
  const descParts = compDesc.split(/[·•]/).map(s => s.trim()).filter(Boolean);

  return {
    ok:             true,
    jobName:        txt("h1"),
    salaryDesc:     txt(".summary-planes__salary"),
    cityName:       cityRaw.split(/\\s+/)[0],
    cityDetail:     cityRaw,
    jobExperience:  expPart,
    jobDegree:      degreePart,
    jd:             txt(".describtion-card__detail-content"),
    brandName:      txt(".company-info__name"),
    brandScaleName: descParts.find(s => /人/.test(s)) ?? "",
    brandStageName: descParts[0] ?? "",
    brandIndustry:  descParts.slice(1).filter(s => !/人/.test(s)).join(" · "),
    companyIntro:   txt(".company-info__intro"),
    workAddress:    txt(".address-info__content"),
  };
})()
`;

// ── CDP 工具函数 ──────────────────────────────────────────────────────────────

/** 获取浏览器级别的 WebSocket URL */
async function getBrowserWsUrl() {
  const res = await fetch(`${CDP_BASE}/json/version`);
  if (!res.ok) throw new Error(`CDP version 请求失败: ${res.status}`);
  const { webSocketDebuggerUrl } = await res.json();
  if (!webSocketDebuggerUrl) throw new Error("CDP 未返回 webSocketDebuggerUrl");
  return webSocketDebuggerUrl;
}

/** 用 WebSocket 发送一条 CDP 命令，返回结果（带超时） */
function cdpCall(ws, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => reject(new Error(`CDP ${method} 超时`)), timeoutMs);
    const handler = (ev) => {
      const msg = JSON.parse(typeof ev === "string" ? ev : ev.data);
      if (msg.id !== id) return;
      ws.removeEventListener("message", handler);
      clearTimeout(timer);
      if (msg.error) reject(new Error(`CDP ${method} 错误: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** 等待 ws 连接就绪 */
function waitOpen(ws, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === 1) return resolve();
    const t = setTimeout(() => reject(new Error("WebSocket 连接超时")), timeoutMs);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(); });
    ws.addEventListener("error", (e) => { clearTimeout(t); reject(new Error(String(e))); });
  });
}

// ── 核心：单条详情拉取 ────────────────────────────────────────────────────────
/**
 * 导航到智联职位详情页，提取 JD 全文及结构化字段。
 * @param {string} url  智联职位详情页 URL
 * @param {{ delayAfterMs?: number }} opts
 * @returns {Promise<Object>}
 */
export async function fetchJobDetail(url, { delayAfterMs = 0 } = {}) {
  const browserWs = await getBrowserWsUrl();

  // 创建独立 Target（新标签页），避免干扰用户正在看的页面
  const browser = new WebSocket(browserWs);
  await waitOpen(browser);

  let targetId, sessionId;
  try {
    const t = await cdpCall(browser, "Target.createTarget", { url: "about:blank" });
    targetId = t.targetId;

    const s = await cdpCall(browser, "Target.attachToTarget", { targetId, flatten: true });
    sessionId = s.sessionId;

    // 通过 sessionId 发送后续命令
    const send = (method, params = {}) => cdpCall(browser, method, params);
    // flatten 模式下通过 sendMessageToTarget 转发
    const page = (method, params = {}) => new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9);
      const timer = setTimeout(() => reject(new Error(`page ${method} 超时`)), 20000);
      const handler = (ev) => {
        const msg = JSON.parse(typeof ev === "string" ? ev : ev.data);
        if (msg.sessionId !== sessionId || msg.id !== id) return;
        browser.removeEventListener("message", handler);
        clearTimeout(timer);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      };
      browser.addEventListener("message", handler);
      browser.send(JSON.stringify({ id, method, params, sessionId }));
    });

    // 启用 Page 域
    await page("Page.enable");

    // 导航到目标 URL
    await page("Page.navigate", { url });

    // 等待 JD 内容出现（最多 15s，每 600ms 轮询）
    const deadline = Date.now() + 15000;
    let extracted = null;
    while (Date.now() < deadline) {
      await sleep(600);
      const evalRes = await page("Runtime.evaluate", {
        expression:    EXTRACT_SCRIPT,
        returnByValue: true,
        awaitPromise:  false,
      });
      const val = evalRes?.result?.value;
      if (val?.ok && val.jd) {
        extracted = val;
        break;
      }
    }

    if (!extracted) {
      // 安全验证页或内容未加载
      const pageText = await page("Runtime.evaluate", {
        expression: "document.title + ' | ' + document.body?.innerText?.slice(0,200)",
        returnByValue: true,
      });
      const preview = pageText?.result?.value ?? "";
      return {
        ok: false, url,
        error: preview.includes("验证") ? "安全验证拦截（需要人工处理）" : "JD内容未加载",
        preview,
      };
    }

    if (delayAfterMs > 0) await sleep(delayAfterMs);
    return { ...extracted, url };

  } finally {
    // 关闭创建的标签页
    try { await cdpCall(browser, "Target.closeTarget", { targetId }); } catch {}
    browser.close();
  }
}

// ── 批量拉取 ──────────────────────────────────────────────────────────────────
/**
 * 批量拉取职位详情（串行，带间隔）
 * @param {string[]} urls
 * @param {{ delayMs?: number, onProgress?: (done, total, result) => void }} opts
 */
export async function fetchJobDetails(urls, { delayMs = 3000, onProgress } = {}) {
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const detail = await fetchJobDetail(url, { delayAfterMs: i < urls.length - 1 ? delayMs : 0 });
      results.push(detail);
      onProgress?.(i + 1, urls.length, detail);
    } catch (err) {
      const r = { ok: false, url, error: err.message };
      results.push(r);
      onProgress?.(i + 1, urls.length, r);
    }
  }
  return results;
}

// ── 参数解析 ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { url: "", report: "", outDir: "", delayMs: 3000, skipExisting: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url")        { out.url         = argv[++i] || ""; continue; }
    if (a === "--report")     { out.report      = argv[++i] || ""; continue; }
    if (a === "--out-dir")    { out.outDir      = argv[++i] || ""; continue; }
    if (a === "--delay")      { out.delayMs     = Number(argv[++i] || "3") * 1000; continue; }
    if (a === "--no-skip")    { out.skipExisting = false; continue; }
    if (a === "--help" || a === "-h") {
      console.log([
        "Usage:",
        "  node zhaopin-jd-fetch.mjs --url <url>",
        "  node zhaopin-jd-fetch.mjs --report <report.json> [--out-dir <dir>]",
        "                            [--delay <秒，默认3>] [--no-skip]",
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 确保调试 Chrome 已就绪
  await ensureChrome({ scriptName: "zhaopin-jd-fetch" });
  await ensureLoggedIn("zhaopin", { cdpUrl: CDP_BASE, scriptName: "zhaopin-jd-fetch", skipVerify: true });

  // ── 模式 A：单条 URL ────────────────────────────────────────────────────────
  if (opts.url) {
    console.error(`[zhaopin-jd-fetch] 拉取: ${opts.url}`);
    const detail = await fetchJobDetail(opts.url);
    console.log(JSON.stringify(detail, null, 2));
    return;
  }

  // ── 模式 B：从 report.json 批量拉取 ─────────────────────────────────────────
  if (opts.report) {
    const reportPath = path.resolve(opts.report);
    let report;
    try {
      report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    } catch (err) {
      console.error(`[zhaopin-jd-fetch] 读取 report 失败: ${err.message}`);
      process.exit(1);
    }

    const jobs = Array.isArray(report.dedupJobs) ? report.dedupJobs : [];
    if (jobs.length === 0) {
      console.error("[zhaopin-jd-fetch] report.dedupJobs 为空，无可拉取");
      process.exit(0);
    }

    const targets = opts.skipExisting ? jobs.filter(j => !j.jd) : jobs;
    console.error(
      `[zhaopin-jd-fetch] 共 ${jobs.length} 条，需拉取 ${targets.length} 条` +
      (targets.length < jobs.length ? `（跳过 ${jobs.length - targets.length} 条已有JD）` : "") +
      `，间隔 ${opts.delayMs / 1000}s`
    );

    if (targets.length === 0) {
      console.error("[zhaopin-jd-fetch] 全部已有JD，无需重复拉取");
      return;
    }

    const details = await fetchJobDetails(
      targets.map(j => j.url),
      {
        delayMs: opts.delayMs,
        onProgress: (done, total, r) => {
          const status = r.ok
            ? `✓ ${r.jobName || r.url}`
            : `✗ ${r.error}`;
          console.error(`[zhaopin-jd-fetch] [${done}/${total}] ${status}`);
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
        jd:             d.jd             || "",
        companyIntro:   d.companyIntro   || "",
        workAddress:    d.workAddress    || "",
        brandIndustry:  d.brandIndustry  || j.brandIndustry  || "",
        brandScaleName: d.brandScaleName || j.brandScaleName || "",
        brandStageName: d.brandStageName || j.brandStageName || "",
      };
    });

    const ok    = details.filter(d => d.ok).length;
    const fail  = details.length - ok;

    const outDir = opts.outDir ? path.resolve(opts.outDir) : path.dirname(reportPath);
    await fs.mkdir(outDir, { recursive: true });
    const jdReportPath = path.join(outDir, "jd-report.json");
    await fs.writeFile(jdReportPath, JSON.stringify({
      ...report,
      dedupJobs:     enrichedJobs,
      jdFetchedAt:   new Date().toISOString(),
      jdFetchCount:  enriched,
      jdFailCount:   fail,
    }, null, 2));

    console.log(JSON.stringify({
      ok: true, source: "zhaopin", mode: "jd-batch",
      total: jobs.length, fetched: ok, skipped: jobs.length - targets.length,
      failed: fail, enriched, jdReportPath,
    }, null, 2));
    return;
  }

  console.error("[zhaopin-jd-fetch] 请指定 --url 或 --report，使用 --help 查看用法");
  process.exit(1);
}

import { fileURLToPath } from "node:url";
const _thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(_thisFile)) {
  main().catch(err => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}
