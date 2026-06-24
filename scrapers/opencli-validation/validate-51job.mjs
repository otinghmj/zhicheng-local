#!/usr/bin/env node
/**
 * OpenCLI vs 原脚本 — 前程无忧(51job)数据采集验证
 *
 * 验证维度：
 *   1. 基础连通性（是否正常返回数据）
 *   2. 数据完整性（salary/company/city 各字段填充率）
 *   3. 风控检测（WAF / 空结果 / 反爬特征词）
 *   4. 翻页稳定性（--limit 增大时是否触发风控）
 *   5. 采集速度
 *
 * 用法：
 *   node scrapers/opencli-validation/validate-51job.mjs
 *   node scrapers/opencli-validation/validate-51job.mjs --query SQE --city 广州 --limit 10
 *   node scrapers/opencli-validation/validate-51job.mjs --rounds 3
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    query:  "SQE",
    city:   "广州",
    limit:  10,
    rounds: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query")  { out.query  = argv[++i]; continue; }
    if (a === "--city")   { out.city   = argv[++i]; continue; }
    if (a === "--limit")  { out.limit  = Number(argv[++i]); continue; }
    if (a === "--rounds") { out.rounds = Number(argv[++i]); continue; }
  }
  return out;
}

async function runOpencli(args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = "";
    let stderr = "";

    const child = spawn("opencli", args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => {
      stderr += c;
      process.stderr.write(c);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, error: "timeout", durationMs: Date.now() - t0, raw: stdout, stderr });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      if (code !== 0) {
        resolve({ ok: false, error: `exit ${code}`, durationMs, raw: stdout, stderr });
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const jobs = Array.isArray(parsed) ? parsed : parsed.data ?? parsed.jobs ?? [];
        resolve({ ok: true, jobs, raw: stdout, durationMs, stderr });
      } catch {
        resolve({ ok: true, jobs: [], rawText: stdout, durationMs, stderr, note: "非JSON格式" });
      }
    });
  });
}

function detectRiskControl(result) {
  const signals = [];
  const text = (result.raw || "") + (result.stderr || "") + (result.error || "");
  // "验证" 在职位 tags 里很常见（"验证工程师"等），只检查 stderr/error，不检查 stdout
  const checkText = (result.stderr || "") + (result.error || "");
  const stdoutRiskKeywords = ["风控", "blocked", "captcha", "频繁", "waf", "WAF", "异常访问", "robot", "AuthRequired", "安全验证", "Cookie已过期"];
  const allRiskKeywords = [...stdoutRiskKeywords, "验证码"];
  for (const kw of allRiskKeywords) {
    if (checkText.toLowerCase().includes(kw.toLowerCase())) signals.push(kw);
  }
  for (const kw of stdoutRiskKeywords) {
    if ((result.raw || "").toLowerCase().includes(kw.toLowerCase())) signals.push(`stdout:${kw}`);
  }
  if (result.ok && result.jobs?.length === 0 && !result.rawText) signals.push("空结果（可能被拦截）");
  return signals;
}

// 数据质量分析（字段名来自 opencli 51job search --help）
// 输出列: rank, jobId, title, salary, salaryMin, salaryMax, city, district, workYear, degree,
//         tags, company, companyFull, companyType, companySize, industry, hr, issueDate, url, companyUrl, encCoId
function analyzeQuality(jobs) {
  if (!jobs.length) return null;

  const coreFields = ["title", "salary", "company", "city", "degree", "url"];
  const rates = {};
  for (const f of coreFields) {
    const filled = jobs.filter(j => j[f] && String(j[f]).trim().length > 0).length;
    rates[f] = `${filled}/${jobs.length} (${Math.round(filled/jobs.length*100)}%)`;
  }

  // salary 额外检查 salaryMin 数值是否有效
  const salaryNumFill = jobs.filter(j => Number(j.salaryMin) > 0).length;
  rates["salaryMin(数值)"] = `${salaryNumFill}/${jobs.length} (${Math.round(salaryNumFill/jobs.length*100)}%)`;

  return { rates, sampleFields: Object.keys(jobs[0]), sampleJob: jobs[0] };
}

async function runRound(options, roundNum) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`第 ${roundNum} 轮 — 前程无忧  query="${options.query}" city="${options.city}" limit=${options.limit}`);
  console.log(`${"=".repeat(60)}`);

  // 测试1：JSON 格式搜索
  console.log("\n[测试1] opencli 51job search (JSON 格式)");
  const t1 = await runOpencli([
    "51job", "search", options.query,
    "--area", options.city,
    "--limit", String(options.limit),
    "--format", "json"
  ]);
  const risk1 = detectRiskControl(t1);
  console.log(`  状态: ${t1.ok ? "✅ 成功" : "❌ 失败"}`);
  console.log(`  耗时: ${t1.durationMs}ms`);
  console.log(`  结果数: ${t1.jobs?.length ?? "N/A"}`);
  if (risk1.length) console.log(`  ⚠️  风控信号: ${risk1.join(", ")}`);
  if (t1.error) console.log(`  错误: ${t1.error}`);
  if (t1.stderr) console.log(`  stderr: ${t1.stderr.slice(0, 200)}`);

  if (t1.jobs?.length > 0) {
    const q = analyzeQuality(t1.jobs);
    if (q) {
      console.log("  字段填充率:", JSON.stringify(q.rates));
      console.log("  字段列表:", q.sampleFields.join(", "));
      console.log("  样本职位:\n" + JSON.stringify(q.sampleJob, null, 2).split("\n").map(l => "    " + l).join("\n"));
    }
  } else if (t1.rawText) {
    console.log("  原始输出(前500字):", t1.rawText.slice(0, 500));
  } else {
    console.log("  原始输出:", t1.raw?.slice(0, 300));
  }

  // 测试2：表格格式
  console.log("\n[测试2] opencli 51job search (默认表格格式)");
  const t2 = await runOpencli([
    "51job", "search", options.query,
    "--area", options.city,
    "--limit", "5"
  ]);
  const risk2 = detectRiskControl(t2);
  console.log(`  状态: ${t2.ok ? "✅ 成功" : "❌ 失败"}`);
  console.log(`  耗时: ${t2.durationMs}ms`);
  if (risk2.length) console.log(`  ⚠️  风控信号: ${risk2.join(", ")}`);
  if (t2.rawText) {
    console.log("  输出:\n" + t2.rawText.split("\n").map(l => "    " + l).join("\n"));
  }

  // 测试3：hot（热门职位，不带查询词，看基础连通性）
  console.log("\n[测试3] opencli 51job hot (不带关键词)");
  const t3 = await runOpencli(["51job", "hot", "--format", "json", "--limit", "5"], 30_000);
  const risk3 = detectRiskControl(t3);
  console.log(`  状态: ${t3.ok ? "✅ 成功" : "❌ 失败"}`);
  console.log(`  耗时: ${t3.durationMs}ms`);
  console.log(`  结果数: ${t3.jobs?.length ?? "N/A"}`);
  if (risk3.length) console.log(`  ⚠️  风控信号: ${risk3.join(", ")}`);

  // 测试4：detail（如果搜索返回了 id）
  // detail 用 encCoId（公司详情）或 jobId
  const firstJob = t1.jobs?.[0];
  const jobId = firstJob?.jobId || firstJob?.encCoId;
  if (jobId) {
    console.log(`\n[测试4] opencli 51job detail ${jobId}`);
    const t4 = await runOpencli(["51job", "detail", String(jobId), "--format", "json"], 30_000);
    const risk4 = detectRiskControl(t4);
    console.log(`  状态: ${t4.ok ? "✅ 成功" : "❌ 失败"}`);
    console.log(`  耗时: ${t4.durationMs}ms`);
    if (risk4.length) console.log(`  ⚠️  风控信号: ${risk4.join(", ")}`);
    const detail = t4.jobs?.[0] ?? (t4.raw ? (() => { try { return JSON.parse(t4.raw); } catch { return null; } })() : null);
    if (detail) {
      console.log("  JD字段:", Object.keys(detail).join(", "));
      console.log("  描述长度:", String(detail.description || detail.jobDesc || detail.desc || detail.jobResponsibility || "").length, "字符");
    }
  } else {
    console.log("\n[测试4] 跳过 51job detail（首轮无 jobId）");
  }

  return {
    round: roundNum,
    test1: { ok: t1.ok, count: t1.jobs?.length, durationMs: t1.durationMs, riskSignals: risk1 },
    test2: { ok: t2.ok, durationMs: t2.durationMs, riskSignals: risk2 },
    test3: { ok: t3.ok, count: t3.jobs?.length, durationMs: t3.durationMs, riskSignals: risk3 },
    sampleJob: t1.jobs?.[0] ?? null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];

  for (let r = 1; r <= options.rounds; r++) {
    if (r > 1) {
      const delay = 20_000 + Math.random() * 10_000;
      console.log(`\n⏳ 轮间等待 ${Math.round(delay/1000)}s...`);
      await new Promise(res => setTimeout(res, delay));
    }
    results.push(await runRound(options, r));
  }

  console.log("\n" + "=".repeat(60));
  console.log("汇总报告");
  console.log("=".repeat(60));
  const successRounds = results.filter(r => r.test1.ok && !r.test1.riskSignals.length);
  console.log(`成功率: ${successRounds.length}/${results.length} 轮`);
  console.log(`平均耗时: ${Math.round(results.reduce((s, r) => s + (r.test1.durationMs || 0), 0) / results.length)}ms`);
  console.log(`平均结果数: ${Math.round(results.reduce((s, r) => s + (r.test1.count || 0), 0) / results.length)}`);

  const anyRisk = results.filter(r => r.test1.riskSignals.length > 0);
  if (anyRisk.length) {
    console.log(`⚠️  风控触发轮次: ${anyRisk.map(r => r.round).join(", ")}`);
  } else {
    console.log("✅ 全程无风控信号");
  }

  const outPath = path.join(__dirname, "output", `51job-validation-${Date.now()}.json`);
  await fs.writeFile(outPath, JSON.stringify({ options, results }, null, 2));
  console.log(`\n结果已保存: ${outPath}`);
}

main().catch(err => {
  console.error("验证脚本错误:", err.message);
  process.exit(1);
});
