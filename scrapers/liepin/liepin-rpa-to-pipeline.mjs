#!/usr/bin/env node
// 猎聘采集报告 → pipeline.md 写入器

import fs   from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { PIPELINE_PATH } from "../shared/paths.mjs";

const DEFAULT_PIPELINE = PIPELINE_PATH;

function pipelineValue(value) {
  return String(value ?? "").replaceAll("|", "｜").replace(/\s+/g, " ").trim();
}

function formatPendingLine(job) {
  const location = [job.cityName, job.areaDistrict].filter(Boolean).join("·");
  const experience = job.experience ?? job.jobExperience;
  const education = job.degree ?? job.jobDegree;
  const industry = job.industry ?? job.brandIndustry;
  const companySize = job.companySize ?? job.brandScaleName;

  // Keep this line aligned with web/server/src/parsers/pipeline.mjs: ten fields, ending in a five-point score.
  return `- [ ] ${[
    job.url,
    job.brandName,
    job.jobName,
    job.salaryDesc,
    location,
    experience,
    education,
    industry,
    companySize,
    "初筛分: 0/5",
  ].map(pipelineValue).join(" | ")}`;
}

function pipelineUrl(line) {
  const match = line.match(/https?:\/\/[^\s|]*liepin\.com[^\s|]*/);
  return match?.[0]?.split("?")[0];
}

function isCurrentPipelineLine(line) {
  const fields = line.replace(/^\s*-\s*\[[ xX]\]\s*/, "").split("|").map((field) => field.trim());
  return fields.length === 10 && /^初筛分:\s*\d+(?:\.\d+)?\s*\/\s*5$/.test(fields[9] ?? "");
}

function extractExistingEntries(content) {
  const entries = new Map();
  for (const line of content.split("\n")) {
    const url = pipelineUrl(line);
    if (url) entries.set(url, { valid: isCurrentPipelineLine(line) });
  }
  return entries;
}

function insertIntoPending(content, newLines) {
  const processedIdx = content.indexOf("\n## Processed");
  const pendingIdx   = content.indexOf("## Pending");
  if (pendingIdx === -1) {
    return content + "\n" + newLines.join("\n") + "\n";
  }
  const insert = "\n" + newLines.join("\n");
  if (processedIdx !== -1) {
    return content.slice(0, processedIdx) + insert + content.slice(processedIdx);
  }
  return content + insert + "\n";
}

export async function writeToPipeline({ reportPath, pipelinePath = DEFAULT_PIPELINE, dryRun = false } = {}) {
  if (!reportPath) throw new Error("reportPath 必填");

  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  const jobs   = Array.isArray(report.dedupJobs) ? report.dedupJobs : [];
  if (jobs.length === 0) return { added: 0, skipped: 0, reportPath };

  let pipelineContent = "";
  try {
    pipelineContent = await fs.readFile(pipelinePath, "utf8");
  } catch {
    pipelineContent = "## Pending\n\n## Processed\n";
  }

  const existingEntries = extractExistingEntries(pipelineContent);

  const toAdd = [];
  const repairUrls = new Set();
  let skipped = 0;
  for (const job of jobs) {
    if (!job.url) { skipped++; continue; }
    const cleanUrl = job.url.split("?")[0];
    const existing = existingEntries.get(cleanUrl);
    if (existing?.valid) { skipped++; continue; }
    if (existing) repairUrls.add(cleanUrl);
    toAdd.push(formatPendingLine(job));
  }

  if (dryRun) {
    console.log(`[dry-run] 将新增 ${toAdd.length} 条，跳过 ${skipped} 条`);
    toAdd.forEach((l) => console.log(" ", l));
    return { added: toAdd.length, skipped, dryRun: true, reportPath };
  }

  if (toAdd.length > 0) {
    if (repairUrls.size > 0) {
      pipelineContent = pipelineContent
        .split("\n")
        .filter((line) => !repairUrls.has(pipelineUrl(line)) || isCurrentPipelineLine(line))
        .join("\n");
    }
    const updated = insertIntoPending(pipelineContent, toAdd);
    await fs.writeFile(pipelinePath, updated, "utf8");
  }

  return { added: toAdd.length, skipped, repaired: repairUrls.size, reportPath };
}

// CLI 直接运行
if (process.argv[1] && process.argv[1].endsWith("liepin-rpa-to-pipeline.mjs")) {
  const args = process.argv.slice(2);
  const reportIdx = args.indexOf("--report");
  const dryRun    = args.includes("--dry-run");
  const reportPath = reportIdx !== -1 ? args[reportIdx + 1] : args[0];
  if (!reportPath) {
    console.error("Usage: node liepin-rpa-to-pipeline.mjs <report.json> [--dry-run]");
    process.exit(1);
  }
  writeToPipeline({ reportPath: path.resolve(reportPath), dryRun })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
