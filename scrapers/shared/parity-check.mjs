#!/usr/bin/env node
// 采集脚本对拍校验：新脚本（candidate）vs 金标准基线（baseline）
//
// 用途：RPA → CDP 升级时，证明新采集脚本产出的数据 ≥ 旧脚本，
//       达标才允许切换 scrapers/registry.json。
//
// 用法：
//   node scrapers/shared/parity-check.mjs \
//     --baseline output/zhaopin/rpa/<q>/<city>/baseline/report.json \
//     --candidate output/zhaopin/cdp/<q>/<city>/report.json
//
// 可选阈值（默认对应验证方案门槛）：
//   --min-count-ratio 0.95     新 dedupCount ≥ 基线 × 该比例
//   --min-intersection 0.90    职位交集 ≥ 基线 × 该比例（按 encryptJobId/url）
//   --min-salary-ratio 1.0     新 salaryDesc 填充率 ≥ 基线 × 该比例
//
// 退出码：全部门槛通过 → 0，任一失败 → 1（可直接接 CI / 切换前把关）。

import fs from "node:fs/promises";

const REQUIRED_FIELDS = ["jobName", "brandName", "url", "cityName"]; // 必填，不得回归为空
const SALARY_FIELD    = "salaryDesc";                                // 单独追踪填充率

function parseArgs(argv) {
  const out = {
    baseline: "", candidate: "",
    minCountRatio: 0.95, minIntersection: 0.90, minSalaryRatio: 1.0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline")         { out.baseline        = argv[++i] || ""; continue; }
    if (a === "--candidate")        { out.candidate       = argv[++i] || ""; continue; }
    if (a === "--min-count-ratio")  { out.minCountRatio   = Number(argv[++i]); continue; }
    if (a === "--min-intersection") { out.minIntersection = Number(argv[++i]); continue; }
    if (a === "--min-salary-ratio") { out.minSalaryRatio  = Number(argv[++i]); continue; }
    if (a === "--help" || a === "-h") {
      console.log("Usage: node parity-check.mjs --baseline <report.json> --candidate <report.json> [--min-count-ratio 0.95] [--min-intersection 0.90] [--min-salary-ratio 1.0]");
      process.exit(0);
    }
    throw new Error(`未知参数: ${a}`);
  }
  if (!out.baseline || !out.candidate) throw new Error("必须提供 --baseline 和 --candidate");
  return out;
}

async function loadReport(p) {
  const r = JSON.parse(await fs.readFile(p, "utf8"));
  const jobs = Array.isArray(r.dedupJobs) ? r.dedupJobs : [];
  return { report: r, jobs };
}

function jobKey(j) {
  return String(j.encryptJobId || j.url || `${j.jobName}|${j.salaryDesc}|${j.cityName}`);
}

function fillRate(jobs, field) {
  if (!jobs.length) return 0;
  const filled = jobs.filter(j => j[field] != null && String(j[field]).trim().length > 0).length;
  return filled / jobs.length;
}

function keySet(jobs) {
  const s = new Set();
  for (const j of jobs) for (const k of Object.keys(j)) s.add(k);
  return s;
}

function pct(x) { return `${(x * 100).toFixed(1)}%`; }

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const base = await loadReport(opt.baseline);
  const cand = await loadReport(opt.candidate);

  const results = []; // { name, detail, pass }
  const add = (name, detail, pass) => results.push({ name, detail, pass });

  // ── 门槛 1：数量 ──────────────────────────────────────────────
  const baseN = base.jobs.length, candN = cand.jobs.length;
  const countRatio = baseN ? candN / baseN : (candN > 0 ? 1 : 0);
  add("数量", `基线 ${baseN} → 新 ${candN}（${pct(countRatio)}，门槛 ≥${pct(opt.minCountRatio)}）`,
      countRatio >= opt.minCountRatio);

  // ── 门槛 2：职位交集 ─────────────────────────────────────────
  const baseKeys = new Set(base.jobs.map(jobKey));
  const candKeys = new Set(cand.jobs.map(jobKey));
  let overlap = 0;
  for (const k of baseKeys) if (candKeys.has(k)) overlap++;
  const interRatio = baseKeys.size ? overlap / baseKeys.size : 0;
  const candOnly = [...candKeys].filter(k => !baseKeys.has(k)).length;
  add("交集", `重叠 ${overlap}/${baseKeys.size}（${pct(interRatio)}，门槛 ≥${pct(opt.minIntersection)}）｜新增 ${candOnly} 条`,
      interRatio >= opt.minIntersection);

  // ── 门槛 3：薪资填充率 ───────────────────────────────────────
  const baseSalary = fillRate(base.jobs, SALARY_FIELD);
  const candSalary = fillRate(cand.jobs, SALARY_FIELD);
  const salaryOk = baseSalary === 0 ? true : candSalary >= baseSalary * opt.minSalaryRatio;
  add("薪资填充", `基线 ${pct(baseSalary)} → 新 ${pct(candSalary)}（门槛 ≥基线×${opt.minSalaryRatio}）`, salaryOk);

  // ── 门槛 4：必填字段无回归 ───────────────────────────────────
  const fieldRows = [];
  let fieldsOk = true;
  for (const f of REQUIRED_FIELDS) {
    const b = fillRate(base.jobs, f), c = fillRate(cand.jobs, f);
    const ok = c >= Math.min(b, 1) - 1e-9; // 新 ≥ 基线
    if (!ok) fieldsOk = false;
    fieldRows.push(`${f}:${pct(c)}${ok ? "" : `(↓基线${pct(b)})`}`);
  }
  add("必填字段", fieldRows.join("  "), fieldsOk);

  // ── 门槛 5：schema 契约（新须覆盖基线全部 key）────────────────
  const bk = keySet(base.jobs), ck = keySet(cand.jobs);
  const missing = [...bk].filter(k => !ck.has(k));
  add("契约schema", missing.length ? `缺失 key: ${missing.join(", ")}` : `全部 ${bk.size} 字段一致`,
      missing.length === 0);

  // ── 输出 ─────────────────────────────────────────────────────
  const allPass = results.every(r => r.pass);
  console.log(`\n对拍：${opt.baseline}\n  vs ${opt.candidate}\n`);
  for (const r of results) console.log(`  ${r.pass ? "✅" : "❌"} ${r.name.padEnd(6)} ${r.detail}`);
  console.log(`\n${allPass ? "✅ 全部门槛通过，可进入切换流程" : "❌ 存在未达标门槛，禁止切换 registry"}\n`);
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error(`[parity-check] 错误: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
