#!/usr/bin/env node
/**
 * ensure-chrome.mjs
 * 采集前置检查：确保调试 Chrome 已就绪，并返回可用的 CDP URL。
 *
 * 设计说明：
 *   允许普通 Chrome 和调试 Chrome（chrome-boss-debug）并存，这是正常使用状态。
 *   - 普通 Chrome：用户日常浏览，不做任何干预
 *   - 调试 Chrome：固定采集实例（--user-data-dir=chrome-boss-debug --remote-debugging-port=9223）
 *
 *   探测顺序：
 *     1. 优先检查 cdpUrl 参数指定的端口（默认 9223）
 *     2. 若无响应，扫描备选端口（9222、9224）——用户可能开了不同端口
 *     3. 若全部无响应且 autoStart=true，尝试自动启动调试 Chrome
 *     4. 若仍失败：exitOnFail=true（默认）则退出并打印指引；否则返回 null
 *
 *   返回值：{ cdpUrl, browser } 或 null（仅当 exitOnFail=false 且未找到时）
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";

const FALLBACK_PORTS = [9223, 9222, 9224];
const USER_DATA_DIR  = `${os.homedir()}/chrome-boss-debug`;
const CHROME_PATH    = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** 探测单个 CDP 地址是否有 Chrome 响应，返回 version 信息或 null */
async function probeCdp(url) {
  try {
    const res = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) return await res.json();
  } catch {}
  return null;
}

/** 扫描备选端口，返回第一个有响应的 { cdpUrl, info } 或 null */
async function scanFallbackPorts(preferredUrl) {
  // 先检查首选
  const info = await probeCdp(preferredUrl);
  if (info) return { cdpUrl: preferredUrl, info };

  // 扫描其余备选
  for (const port of FALLBACK_PORTS) {
    const url = `http://127.0.0.1:${port}`;
    if (url === preferredUrl) continue;
    const i = await probeCdp(url);
    if (i) return { cdpUrl: url, info: i };
  }
  return null;
}

/** 尝试自动启动调试 Chrome，等待最多 waitMs 毫秒 */
async function autoStartChrome(preferredUrl, waitMs = 6000) {
  const port = new URL(preferredUrl).port || "9223";
  const child = spawn(
    CHROME_PATH,
    [
      `--user-data-dir=${USER_DATA_DIR}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    { stdio: "ignore", detached: true },
  );
  child.unref();

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(500);
    const info = await probeCdp(preferredUrl);
    if (info) return info;
  }
  return null;
}

/**
 * 确保调试 Chrome 已启动，返回可用的 CDP URL。
 *
 * @param {object}  opts
 * @param {string}  opts.scriptName   日志前缀（默认 "scraper"）
 * @param {string}  opts.cdpUrl       优先检查的 CDP 地址（默认读 env BOSS_CDP_URL / CDP_URL，再 127.0.0.1:9223）
 * @param {boolean} opts.autoStart    找不到时是否尝试自动启动 Chrome（默认 true）
 * @param {boolean} opts.exitOnFail   启动失败时是否 process.exit(1)（默认 true）
 *
 * @returns {Promise<string|null>}  返回实际可用的 cdpUrl；exitOnFail=false 时失败返回 null
 */
export async function ensureChrome({
  scriptName  = "scraper",
  cdpUrl      = process.env.BOSS_CDP_URL || process.env.CDP_URL || "http://127.0.0.1:9223",
  autoStart   = true,
  exitOnFail  = true,
} = {}) {
  // ── Step 1: 探测已有进程 ─────────────────────────────────────────────────────
  const found = await scanFallbackPorts(cdpUrl);
  if (found) {
    const ver = found.info.Browser ?? "Chrome";
    if (found.cdpUrl !== cdpUrl) {
      console.error(`[${scriptName}] ✅ 调试 Chrome 就绪（${found.cdpUrl}，${ver}）`);
    } else {
      console.error(`[${scriptName}] ✅ 调试 Chrome 就绪（${found.cdpUrl}，${ver}）`);
    }
    return found.cdpUrl;
  }

  // ── Step 2: 尝试自动启动 ────────────────────────────────────────────────────
  if (autoStart) {
    console.error(`[${scriptName}] 🚀 未检测到调试 Chrome，尝试自动启动...`);
    const info = await autoStartChrome(cdpUrl);
    if (info) {
      console.error(`[${scriptName}] ✅ 调试 Chrome 已自动启动（${cdpUrl}，${info.Browser ?? "Chrome"}）`);
      return cdpUrl;
    }
    console.error(`[${scriptName}] ⚠️  自动启动失败（Chrome 未安装或路径不对？）`);
  }

  // ── Step 3: 失败处理 ────────────────────────────────────────────────────────
  const msg = [
    `\n[${scriptName}] ❌ 调试 Chrome 未运行（已扫描端口 ${FALLBACK_PORTS.join("/")}）`,
    `  请手动启动：`,
    `  open -na "Google Chrome" --args \\`,
    `    --user-data-dir=${USER_DATA_DIR} \\`,
    `    --remote-debugging-port=9223 \\`,
    `    --no-first-run --no-default-browser-check`,
    "",
  ].join("\n");

  if (exitOnFail) {
    console.error(msg);
    process.exit(1);
  }

  console.error(msg.trim());
  return null;
}
