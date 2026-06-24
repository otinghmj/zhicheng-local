#!/usr/bin/env node
// 前程无忧（51job）采集报告 → pipeline.md 写入器
//
// 与 boss-rpa-to-pipeline.mjs 结构相同，但使用 51job URL 格式做去重。

import fs   from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PIPELINE = path.resolve("data/pipeline.md");

function formatPendingLine(job) {
  const location = [job.cityName, job.areaDistrict].filter(Boolean).join("·");
  const skills   = Array.isArray(job.skills)      ? job.skills.join("、")      : (job.skills      || "");
  const welfare  = Array.isArray(job.welfareList) ? job.welfareList.join("、") : (job.welfareList || "");
  const labels   = Array.isArray(job.jobLabels)   ? job.jobLabels.join("、")   : (job.jobLabels   || "");
  return `- [ ] ${job.url} | ${job.brandName} | ${job.jobName} | ${job.salaryDesc} | ${location} |${job.jobExperience}| ${job.jobDegree}|${job.brandIndustry}|${job.brandScaleName}|${job.brandStageName}|${skills}|${welfare}|${labels}`;
}

// 从 pipeline.md 内容中提取已有的 51job URL（用于去重）
function extractExistingUrls(content) {
  const urls = new Set();
  for (const line of content.split("\n")) {
    // 匹配 jobs.51job.com 或 we.51job.com 的 URL
    const m = line.match(/https?:\/\/[^\s|]*51job\.com[^\s|]*/);
    if (m) urls.add(m[0].split("?")[0]); // 去掉 query string 再比对
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
    console.log(`[dry-run] Would add ${toAdd.length} entries, skip ${skipped}:`);
    toAdd.forEach((l) => console.log(" ", l));
    return { added: toAdd.length, skipped, dryRun: true, reportPath };
  }

  if (toAdd.length > 0) {
    const updated = insertIntoPending(pipelineContent, toAdd);
    await fs.writeFile(pipelinePath, updated, "utf8");
  }

  return { added: toAdd.length, skipped, reportPath, pipelinePath };
}

// CLI entry point
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args         = process.argv.slice(2);
  const dryRun       = args.includes("--dry-run");
  const reportIdx    = args.indexOf("--report");
  const pipelineIdx  = args.indexOf("--pipeline");
  const reportPath   = reportIdx   !== -1 ? args[reportIdx + 1]   : undefined;
  const pipelinePath = pipelineIdx !== -1 ? args[pipelineIdx + 1] : undefined;

  writeToPipeline({ reportPath, pipelinePath, dryRun })
    .then((r) => {
      if (!dryRun) {
        console.log(`pipeline.md: +${r.added} new entries, ${r.skipped} skipped`);
        console.log(`report: ${r.reportPath}`);
      }
    })
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}
