#!/usr/bin/env node
// 前程无忧（51job）OpenCLI 采集脚本 — 替代 51job-hs-rpa.mjs 的 RPA 部分
//
// 依赖：opencli (npm i -g @jackwener/opencli)，Chrome 需登录前程无忧
//
// 用法：
//   node scrapers/51job/51job-opencli.mjs [--query SQE] [--city 030600] [--max-pages 10]
//                                          [--skip-pipeline]
//
// CLI 参数与 51job-hs-rpa.mjs 完全一致，可无缝替换。

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureChrome } from "../shared/ensure-chrome.mjs";
import { ensureLoggedIn } from "../shared/check-login.mjs";
import { outPath as scraperOutPath } from "../shared/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP_URL   = process.env.SCRAPER_CDP_URL || process.env.BOSS_CDP_URL || "http://127.0.0.1:9223";

// 51job 城市码 → 城市名（opencli --area 接受中文）
const CITY_MAP = {
  "000000": "",        // 全国
  "010000": "北京",
  "020000": "上海",
  "030200": "广州",
  "030600": "佛山",
  "030800": "东莞",
  "040000": "深圳",
  "050200": "南京",
  "080200": "武汉",
  "090200": "成都",
  "100200": "西安",
  "110100": "杭州",
  "190200": "苏州",
  "190400": "无锡",
};

function parseArgs(argv) {
  const out = {
    query:        "SQE",
    city:         "030600",
    maxPages:     10,
    skipPipeline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query")         { out.query        = argv[++i] || out.query;       continue; }
    if (a === "--city")          { out.city         = argv[++i] || out.city;        continue; }
    if (a === "--max-pages")     { out.maxPages      = Number(argv[++i] || "10");   continue; }
    if (a === "--skip-pipeline") { out.skipPipeline  = true;                         continue; }
    if (a === "--help" || a === "-h") {
      console.log("Usage: node 51job-opencli.mjs [--query SQE] [--city 030600] [--max-pages 10] [--skip-pipeline]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function cityCodeToName(code) {
  return CITY_MAP[code] || code;
}

// opencli 51job search 返回字段 → pipeline schema（与 slim51Job 输出字段一致）
function mapJob(item = {}) {
  const url = String(item.url || "").split("?")[0]; // 去 query string 保证 dedup 一致性

  // tags: "5-8年,本科,五险一金,补充医疗保险,..." — 过滤掉 exp/degree 作为 welfareList
  const expRe = /^\d+.*[年月]$|^经验不限$|^应届$/;
  const degRe = /^(初中|高中|中专|中技|大专|本科|硕士|博士|MBA|不限)$/;
  const tagItems = String(item.tags || "").split(",").map(s => s.trim()).filter(Boolean);
  const welfareList = tagItems.filter(t => !expRe.test(t) && !degRe.test(t));

  return {
    url,
    encryptJobId:     String(item.jobId  || ""),
    jobName:          String(item.title  || ""),
    brandName:        String(item.company || ""),
    salaryDesc:       String(item.salary  || ""),
    cityName:         String(item.city    || ""),
    areaDistrict:     String(item.district || ""),
    businessDistrict: "",
    jobExperience:    String(item.workYear || ""),
    jobDegree:        String(item.degree   || ""),
    brandIndustry:    String(item.industry || ""),
    brandScaleName:   String(item.companySize || ""),
    brandStageName:   String(item.companyType || ""),
    skills:           [],
    welfareList,
    jobLabels:        [],
  };
}

function dedup(jobs) {
  const seen = new Set();
  return jobs.filter(j => {
    const key = j.encryptJobId || `${j.jobName}|${j.salaryDesc}|${j.cityName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runOpencli(args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = "", stderr = "";
    const child = spawn("opencli", args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", c => { stdout += c; });
    child.stderr.on("data", c => { stderr += c; process.stderr.write(c); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, error: "timeout", stdout, stderr, durationMs: Date.now() - t0 });
    }, timeoutMs);
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - t0 });
    });
  });
}

function printProgress(current, total, found) {
  console.log(`##PROGRESS ${JSON.stringify({ step: "搜索翻页", current, total, found })}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  printProgress(0, options.maxPages, 0);

  await ensureChrome({ scriptName: "51job-opencli" });
  await ensureLoggedIn("51job", { cdpUrl: CDP_URL, scriptName: "51job-opencli", skipVerify: !process.env.SCRAPER_VERIFY_LOGIN });

  const cityName = cityCodeToName(options.city);
  const limit    = options.maxPages * 30; // 每页约30条

  const outDir  = scraperOutPath("51job/rpa", options.query.toLowerCase(), String(options.city));
  const outPath = path.join(outDir, "report.json");
  await fs.mkdir(outDir, { recursive: true });

  console.error(`[51job-opencli] query="${options.query}" city="${options.city}"(${cityName}) limit=${limit}`);

  const cliArgs = [
    "51job", "search", options.query,
    "--area", cityName,
    "--limit", String(limit),
    "--format", "json",
  ];
  if (!cityName) cliArgs.splice(cliArgs.indexOf("--area"), 2); // 全国不传 --area

  const result = await runOpencli(cliArgs);

  if (!result.ok) {
    const errMsg = (result.stderr || result.error || "").slice(-400);
    const report = {
      ok: false, error: errMsg, query: options.query, city: options.city,
      source: "51job", collectionMethod: "opencli-51job-search",
      rawJobCount: 0, dedupJobs: [], dedupCount: 0,
    };
    await fs.writeFile(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: false, source: "51job", query: options.query, reportPath: outPath, error: errMsg }));
    process.exit(1);
  }

  let rawJobs = [];
  try {
    const parsed = JSON.parse(result.stdout);
    rawJobs = Array.isArray(parsed) ? parsed : parsed.data ?? parsed.jobs ?? [];
  } catch {
    const report = {
      ok: false, error: "JSON parse failed", query: options.query, city: options.city,
      source: "51job", collectionMethod: "opencli-51job-search",
      rawJobCount: 0, dedupJobs: [], dedupCount: 0,
    };
    await fs.writeFile(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: false, source: "51job", query: options.query, reportPath: outPath, error: "JSON parse failed" }));
    process.exit(1);
  }

  const dedupJobs = dedup(rawJobs.map(mapJob));

  const finalReport = {
    ok:               true,
    query:            options.query,
    city:             options.city,
    cityName,
    source:           "51job",
    collectionMethod: "opencli-51job-search",
    durationMs:       result.durationMs,
    rawJobCount:      rawJobs.length,
    dedupJobs,
    dedupCount:       dedupJobs.length,
  };

  await fs.writeFile(outPath, JSON.stringify(finalReport, null, 2));

  printProgress(options.maxPages, options.maxPages, dedupJobs.length);
  console.log(JSON.stringify({
    ok:          true,
    source:      "51job",
    query:       options.query,
    reportPath:  outPath,
    dedupCount:  dedupJobs.length,
    rawJobCount: rawJobs.length,
  }, null, 2));

  if (!options.skipPipeline && dedupJobs.length > 0) {
    try {
      const { writeToPipeline } = await import("./51job-rpa-to-pipeline.mjs");
      const r = await writeToPipeline({ reportPath: outPath });
      console.error(`[51job-opencli] pipeline.md: +${r.added} 新增，${r.skipped} 已存在`);
    } catch (err) {
      console.error(`[51job-opencli] pipeline 写入失败: ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
