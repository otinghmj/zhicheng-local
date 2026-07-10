#!/usr/bin/env node
// 猎聘采集报告 → pipeline.md 写入器

import fs   from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { PIPELINE_PATH } from "../shared/paths.mjs";

const DEFAULT_PIPELINE = PIPELINE_PATH;

function formatPendingLine(job) {
  const location = [job.cityName, job.areaDistrict].filter(Boolean).join("·");
  const skills   = Array.isArray(job.skills)      ? job.skills.join("、")      : (job.skills      || "");
  const welfare  = Array.isArray(job.welfareList) ? job.welfareList.join("、") : (job.welfareList || "");
  const labels   = Array.isArray(job.jobLabels)   ? job.jobLabels.join("、")   : (job.jobLabels   || "");
  return `- [ ] ${job.url} | ${job.brandName} | ${job.jobName} | ${job.salaryDesc} | ${location} |${job.jobExperience}| ${job.jobDegree}|${job.brandIndustry}|${job.brandScaleName}|${job.brandStageName}|${skills}|${welfare}|${labels}`;
}

function extractExistingUrls(content) {
  const urls = new Set();
  for (const line of content.split("\n")) {
    const m = line.match(/https?:\/\/[^\s|]*liepin\.com[^\s|]*/);
    if (m) urls.add(m[0].split("?")[0]);
  }
  return urls;
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

  const existingUrls = extractExistingUrls(pipelineContent);

  const toAdd = [];
  let skipped = 0;
  for (const job of jobs) {
    if (!job.url) { skipped++; continue; }
    const cleanUrl = job.url.split("?")[0];
    if (existingUrls.has(cleanUrl)) { skipped++; continue; }
    toAdd.push(formatPendingLine(job));
  }

  if (dryRun) {
    console.log(`[dry-run] 将新增 ${toAdd.length} 条，跳过 ${skipped} 条`);
    toAdd.forEach((l) => console.log(" ", l));
    return { added: toAdd.length, skipped, dryRun: true, reportPath };
  }

  if (toAdd.length > 0) {
    const updated = insertIntoPending(pipelineContent, toAdd);
    await fs.writeFile(pipelinePath, updated, "utf8");
  }

  return { added: toAdd.length, skipped, reportPath };
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
