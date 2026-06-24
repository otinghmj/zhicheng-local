#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureChrome } from "../shared/ensure-chrome.mjs";
import { ensureLoggedIn } from "../shared/check-login.mjs";

const API_PORT = Number(process.env.BOSS_API_PORT || 3337);
const CDP_URL = String(process.env.BOSS_CDP_URL || "http://127.0.0.1:9223");
const API_KEY = String(process.env.BOSS_API_KEY || "").trim();

function parseArgs(argv) {
  const out = {
    query: "SQE",
    city: "101280800",    // BOSS城市码（佛山=101280800；广州=101280100；深圳=101280600）完整列表见 scrapers/shared/city-codes.json
    maxScrollRounds: 20,
    skipApiCollection: false,
    skipPipeline: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--query") { out.query = argv[++i] || out.query; continue; }
    if (arg === "--city") { out.city = argv[++i] || out.city; continue; }
    if (arg === "--max-scroll-rounds") { out.maxScrollRounds = Number(argv[++i] || "20"); continue; }
    if (arg === "--skip-api-collection") { out.skipApiCollection = true; continue; }
    if (arg === "--skip-pipeline") { out.skipPipeline = true; continue; }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node boss-hs-rpa.mjs [--query SQE] [--city 101280800] [--max-scroll-rounds 20] [--skip-api-collection] [--skip-pipeline]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function slimJob(job) {
  const id = String(job.encryptJobId || "");
  return {
    url:              id ? `https://www.zhipin.com/job_detail/${id}.html` : "",
    encryptJobId:     id,
    jobName:          String(job.jobName          || ""),
    brandName:        String(job.brandName        || ""),
    salaryDesc:       String(job.salaryDesc       || ""),
    cityName:         String(job.cityName         || ""),
    areaDistrict:     String(job.areaDistrict     || ""),
    businessDistrict: String(job.businessDistrict || ""),
    jobExperience:    String(job.jobExperience    || ""),
    jobDegree:        String(job.jobDegree        || ""),
    brandIndustry:    String(job.brandIndustry    || ""),
    brandScaleName:   String(job.brandScaleName   || ""),
    brandStageName:   String(job.brandStageName   || ""),
    skills:           Array.isArray(job.skills)      ? job.skills      : [],
    welfareList:      Array.isArray(job.welfareList) ? job.welfareList : [],
    jobLabels:        Array.isArray(job.jobLabels)   ? job.jobLabels   : [],
  };
}

// Track all spawned children so we can kill them on exit
const _activeChildren = new Set();

function _cleanupChildren() {
  for (const child of _activeChildren) {
    try { child.kill("SIGTERM"); } catch { }
  }
  _activeChildren.clear();
}

process.on("SIGINT", () => {
  console.error("\n[boss-hs-rpa] SIGINT received, killing child processes...");
  _cleanupChildren();
  process.exit(130);
});
process.on("SIGTERM", () => {
  _cleanupChildren();
  process.exit(143);
});

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    _activeChildren.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      _activeChildren.delete(child);
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function checkApiServerHealth(port) {
  try {
    const headers = API_KEY ? { "x-api-key": API_KEY } : {};
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ok === true;
  } catch {
    return false;
  }
}

async function checkApiRateLimit(port) {
  try {
    const headers = API_KEY ? { "x-api-key": API_KEY } : {};
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers });
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data?.conservativeDefaults?.rateLimitMaxReq ?? 0);
  } catch {
    return 0;
  }
}

async function killProcessOnPort(port) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync("lsof", ["-ti", `:${port}`]);
    const pids = stdout.trim().split("\n").filter(Boolean);
    if (pids.length > 0) {
      await execFileAsync("kill", ["-TERM", ...pids]).catch(() => {});
      await sleep(800);
    }
  } catch { }
}

async function waitForApiServer(port, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkApiServerHealth(port)) return true;
    await sleep(500);
  }
  return false;
}

function spawnApiServer(port) {
  const serverPath = path.resolve("scrapers/shared/api-server.mjs");
  const env = {
    ...process.env,
    BOSS_API_PORT: String(port),
    BOSS_API_RATE_LIMIT_MAX_REQ: "200",
    BOSS_CDP_URL: CDP_URL
  };
  const child = spawn("node", [serverPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.stdout.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

// Phase 0.5: Start CDP network listener for joblist.json XHR interception.
// Must be called BEFORE Lua starts the search so the first page's response is captured.
async function startListenSession(cdpUrl = CDP_URL) {
  const headers = {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {})
  };
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/boss/searchPage/listen`, {
    method: "POST",
    headers,
    body: JSON.stringify({ cdpUrl })
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`searchPage/listen returned ${res.status}: ${errBody.slice(0, 500)}`);
  }
  return res.json();
}

// Phase 2: Drain accumulated jobs from the listen session.
async function drainListenSession(sessionId) {
  const headers = {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {})
  };
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/boss/searchPage/drain`, {
    method: "POST",
    headers,
    body: JSON.stringify({ sessionId })
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`searchPage/drain returned ${res.status}: ${errBody.slice(0, 500)}`);
  }
  return res.json();
}

// Fallback: DOM-based visible job scrape (no salary, but has href/encryptId).
async function collectVisibleJobsViaApi(cdpUrl = CDP_URL) {
  const headers = {
    "Content-Type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {})
  };
  const res = await fetch(`http://127.0.0.1:${API_PORT}/api/boss/searchPage/visible`, {
    method: "POST",
    headers,
    body: JSON.stringify({ cdpUrl, limit: 200, enrichDescription: false })
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`searchPage/visible returned ${res.status}: ${errBody.slice(0, 500)}`);
  }
  return res.json();
}

function dedup(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    const key = j.encryptId || j.encryptJobId
      || `${j.title || j.jobName}|${j.salaryDesc}|${j.locationName || j.cityName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outDir = path.resolve("output/hammerspoon/boss-rpa", options.query.toLowerCase(), String(options.city));
  const outPath = path.join(outDir, "report.json");       // MJS 最终合并报告
  const hsOutPath = path.join(outDir, "hs-report.json");  // Lua 原始报告（单独路径，避免覆盖）
  await fs.mkdir(outDir, { recursive: true });

  // --- Pre-flight: 确保使用同一个 Chrome（普通 Chrome + debug port）─────────────
  await ensureChrome({ scriptName: "boss-hs-rpa", autoKillDebug: true });

  // --- Pre-flight: 检查 BOSS 直聘登录状态 ──────────────────────────────────────
  // skipVerify=true：wt2 cookie 存在即视为已登录，跳过浏览器内 API 二次验证
  // BOSS jobseeker API 在招聘端账号/某些场景下返回非 0，导致误判未登录
  await ensureLoggedIn("boss", { cdpUrl: CDP_URL, scriptName: "boss-hs-rpa", skipVerify: true });

  // --- Phase 0: Ensure API server is running with sufficient rate limit ---
  // Always restart if existing server has rate limit < 200 (default=2 would exhaust during Lua polling)
  let ownedServer = null;
  const existingRateLimit = await checkApiRateLimit(API_PORT);
  if (existingRateLimit > 0 && existingRateLimit < 200) {
    console.error(`[boss-hs-rpa] Existing API server has rateLimitMaxReq=${existingRateLimit} — restarting with 200...`);
    await killProcessOnPort(API_PORT);
  }
  const alreadyReady = await checkApiServerHealth(API_PORT);
  if (!alreadyReady) {
    console.error(`[boss-hs-rpa] Starting boss-api-server on port ${API_PORT} (rateLimitMaxReq=200)...`);
    ownedServer = spawnApiServer(API_PORT);
    _activeChildren.add(ownedServer);
    const ready = await waitForApiServer(API_PORT, 12000);
    if (!ready) {
      console.error("[boss-hs-rpa] API server failed to start in 12s — Lua pageState calls will fall back to AppleScript");
    }
  } else {
    console.error(`[boss-hs-rpa] API server already running on port ${API_PORT} with sufficient rate limit`);
  }

  // --- Phase 0.5: Start CDP network listener (must precede Lua search) ---
  let listenSessionId = null;
  if (!options.skipApiCollection && await checkApiServerHealth(API_PORT)) {
    try {
      const listenResult = await startListenSession(CDP_URL);
      if (listenResult?.ok && listenResult.sessionId) {
        listenSessionId = listenResult.sessionId;
        console.error(`[boss-hs-rpa] Network listener started: session=${listenSessionId} target=${listenResult.target?.url}`);
      } else {
        console.error(`[boss-hs-rpa] Network listener start failed: ${JSON.stringify(listenResult)}`);
      }
    } catch (err) {
      console.error(`[boss-hs-rpa] Network listener error: ${err.message}`);
    }
  }

  // --- Phase 1: Hammerspoon navigation ---
  // IPC 限制：Legacy IPC 只支持 -c 字符串；同步 dofile 会阻塞主线程导致 IPC 挂起。
  // 解决方案：用 hs.timer.doAfter(0, ...) 异步调度 Lua，hs 命令立即返回，
  // MJS 改为轮询 hs-report.json 出现（最长等待 hsTimeoutMs）。
  const luaPath = path.resolve("scrapers/boss/tools/boss_hammerspoon_rpa.lua");
  // 注意：_cli 是 Hammerspoon 保护名，在 IPC 顶层赋值会导致 exit 65。
  // 解决方案：在 timer 回调内部设置 _hs_args，Lua 脚本优先读取 _hs_args。
  const argsInner = [
    `_hs_args = { args = {`,
    `  "--query", ${JSON.stringify(options.query)},`,
    `  "--city",  ${JSON.stringify(options.city)},`,
    `  "--max-scroll-rounds", ${JSON.stringify(String(options.maxScrollRounds))},`,
    `  "--out",   ${JSON.stringify(hsOutPath)}`,
    `} };`,
    `dofile(${JSON.stringify(luaPath)})`,
  ].join(" ");
  // hs.timer.doAfter(0, fn) 在下一个 run-loop tick 异步执行，不阻塞 IPC
  const hsCode = `hs.timer.doAfter(0, function() ${argsInner} end)`;
  const hsArgs = ["-t", "10", "-c", hsCode];

  let hsError = null;
  try {
    const { stdout: hsOut } = await runCommand("hs", hsArgs, process.cwd());
    console.error(`[boss-hs-rpa] Hammerspoon script scheduled, waiting for hs-report.json...`);
  } catch (err) {
    // exit 69 = IPC receive timeout：hs.timer.doAfter 是异步的，hs 等不到返回值会超时退出。
    // "receive timeout" = timer 已调度、hs 等超时（正常）
    // "send timeout"    = IPC 无法建连，Hammerspoon 真正挂了
    const msg = err.message || "";
    const isReceiveTimeout = msg.includes("receive timeout") || msg.includes("(69)");
    const isSendTimeout    = msg.includes("send timeout");
    if (isReceiveTimeout && !isSendTimeout) {
      console.error(`[boss-hs-rpa] Hammerspoon timer scheduled (IPC receive timeout expected for async timer), polling for hs-report.json...`);
    } else {
      hsError = msg;
      console.error(`[boss-hs-rpa] Hammerspoon schedule error: ${hsError}`);
    }
  }

  // 轮询等待 Lua 写出 hs-report.json（最长 10 分钟）
  let hsReport = {};
  if (!hsError) {
    const hsTimeoutMs = 600_000;
    const pollInterval = 3000;
    const deadline = Date.now() + hsTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollInterval));
      try {
        const raw = await fs.readFile(hsOutPath, "utf8");
        hsReport = JSON.parse(raw);
        console.error(`[boss-hs-rpa] hs-report.json ready (ok=${hsReport.ok})`);
        break;
      } catch { /* 还没写出，继续等 */ }
    }
    if (!hsReport.ok && !hsReport.startedAt) {
      hsError = "hs-report.json 等待超时（10 分钟）";
      console.error(`[boss-hs-rpa] ${hsError}`);
    }
  }

  // --- Phase 2: Drain captured jobs from network listener ---
  let apiJobs = [];
  let collectionMethod = "hs-only";

  if (!options.skipApiCollection && await checkApiServerHealth(API_PORT)) {
    // Primary: drain the listen session (clean salaries from joblist.json)
    if (listenSessionId) {
      try {
        const drainResult = await drainListenSession(listenSessionId);
        if (drainResult?.ok && Array.isArray(drainResult.jobs) && drainResult.jobs.length > 0) {
          apiJobs = drainResult.jobs;
          collectionMethod = "joblist-intercept+hs-nav";
          console.error(`[boss-hs-rpa] joblist intercept: ${apiJobs.length} jobs (with salary)`);
        } else {
          console.error(`[boss-hs-rpa] joblist intercept returned 0 jobs — falling back to DOM scrape`);
        }
      } catch (err) {
        console.error(`[boss-hs-rpa] Drain error: ${err.message}`);
      }
    }

    // Fallback: DOM-based visible scrape (no salary, but has href/encryptId)
    if (apiJobs.length === 0) {
      try {
        const visibleResult = await collectVisibleJobsViaApi(CDP_URL);
        if (Array.isArray(visibleResult?.jobs)) {
          apiJobs = visibleResult.jobs;
          collectionMethod = apiJobs.length > 0 ? "searchPage/visible+hs-nav" : "hs-only";
          console.error(`[boss-hs-rpa] DOM fallback: ${apiJobs.length} jobs`);
        }
      } catch (err) {
        console.error(`[boss-hs-rpa] DOM fallback error: ${err.message}`);
      }
    }
  }

  // --- Phase 3: Merge and deduplicate ---
  const hsJobs = [
    ...(Array.isArray(hsReport?.firstScreenJobs) ? hsReport.firstScreenJobs : []),
    ...(Array.isArray(hsReport?.afterScrollJobs) ? hsReport.afterScrollJobs : [])
  ];

  const allJobs = dedup([...apiJobs, ...hsJobs]).map(slimJob);

  const finalReport = {
    ...hsReport,
    ok: !hsError,
    hsError: hsError || undefined,
    query: options.query,
    city: options.city,
    collectionMethod,
    apiJobCount: apiJobs.length,
    dedupJobs: allJobs,
    dedupCount: allJobs.length
  };

  await fs.writeFile(outPath, JSON.stringify(finalReport, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: !hsError,
    source: "boss",
    method: hsError ? "hs-nav-failed" : collectionMethod,
    query: options.query,
    reportPath: outPath,
    dedupCount: allJobs.length,
    apiJobCount: apiJobs.length,
    hsJobCount: hsJobs.length,
    scrollHasNewData: Boolean(hsReport?.scrollHasNewData),
    finalUrl: hsReport?.actions?.[hsReport.actions?.length - 1]?.afterUrl || "",
    dedupJobs: allJobs,
  }));

  // --- Cleanup: stop API server if we spawned it ---
  if (ownedServer) {
    ownedServer.kill("SIGTERM");
  }

  // --- Auto pipeline write (default on, skip with --skip-pipeline) ---
  if (!options.skipPipeline && allJobs.length > 0) {
    try {
      const { writeToPipeline } = await import("./boss-rpa-to-pipeline.mjs");
      const pipelineResult = await writeToPipeline({ reportPath: outPath });
      console.error(`[boss-hs-rpa] pipeline.md: +${pipelineResult.added} new, ${pipelineResult.skipped} skipped`);
    } catch (err) {
      console.error(`[boss-hs-rpa] pipeline write error: ${err.message}`);
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exit(1);
});
