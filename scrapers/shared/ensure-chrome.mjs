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
import fs from "node:fs";
import path from "node:path";

const FALLBACK_PORTS = [9223, 9222, 9224];
const USER_DATA_DIR  = path.join(os.homedir(), "chrome-boss-debug"); // path.join 跨平台

// C2：按操作系统返回 Chrome 可执行路径（自动适配 Mac / Windows，Linux 不在支持范围）。
// env CHROME_PATH 始终最高优先，换安装位置/换 OS 时贴一张便签即可。
function defaultChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["LOCALAPPDATA"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    ];
    for (const p of candidates) { try { if (p && fs.existsSync(p)) return p; } catch {} }
    return candidates[0]; // 都没探到就返回标准安装位置作兜底
  }
  return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; // 默认 macOS
}
const CHROME_PATH = defaultChromePath();

// C1：managed 模式用 Playwright 自带 Chromium（跨平台、工具自管、登录态持久化到专属 userDataDir）。
// external 模式（默认）沿用系统 Chrome。SCRAPER_LAUNCH_MODE=managed 切换。
const MANAGED_USER_DATA_DIR = path.join(os.homedir(), "chrome-scraper-managed");

async function resolveBrowserExe(launchMode) {
  if (launchMode !== "managed") return { exe: CHROME_PATH, userDataDir: USER_DATA_DIR };
  let exe;
  try {
    const { chromium } = await import("playwright");
    exe = chromium.executablePath();
  } catch (e) {
    throw new Error("managed 模式需要 Playwright：请先运行 `npx playwright install chromium`（" + e.message + "）");
  }
  if (!exe || !fs.existsSync(exe)) {
    throw new Error("Playwright Chromium 未安装：请运行 `npx playwright install chromium`");
  }
  return { exe, userDataDir: MANAGED_USER_DATA_DIR };
}

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

/** 尝试自动启动调试浏览器（external=系统 Chrome / managed=Playwright Chromium），等待最多 waitMs 毫秒 */
async function autoStartChrome(preferredUrl, launchMode, waitMs = 8000) {
  const port = new URL(preferredUrl).port || "9223";
  const { exe, userDataDir } = await resolveBrowserExe(launchMode);
  const child = spawn(
    exe,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    { stdio: "ignore", detached: true },  // headed（不加 --headless），更像真人、便于首次登录
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
  cdpUrl      = process.env.SCRAPER_CDP_URL || process.env.BOSS_CDP_URL || process.env.CDP_URL || "http://127.0.0.1:9223",
  autoStart   = true,
  exitOnFail  = true,
  launchMode  = process.env.SCRAPER_LAUNCH_MODE || "external",  // external=系统Chrome（默认，回退）/ managed=Playwright 自管
} = {}) {
  // ── Step 1: 探测已有进程（两种模式都优先复用已在跑的浏览器）──────────────────
  const found = await scanFallbackPorts(cdpUrl);
  if (found) {
    const ver = found.info.Browser ?? "Chrome";
    console.error(`[${scriptName}] ✅ 调试浏览器就绪（${found.cdpUrl}，${ver}）`);
    return found.cdpUrl;
  }

  // ── Step 2: 尝试自动启动 ────────────────────────────────────────────────────
  if (autoStart) {
    const label = launchMode === "managed" ? "Playwright 自管 Chromium" : "系统调试 Chrome";
    console.error(`[${scriptName}] 🚀 未检测到浏览器，尝试自动启动（${launchMode} 模式 · ${label}）...`);
    try {
      const info = await autoStartChrome(cdpUrl, launchMode);
      if (info) {
        console.error(`[${scriptName}] ✅ 已自动启动（${cdpUrl}，${info.Browser ?? "Chromium"}）`);
        if (launchMode === "managed") {
          console.error(`[${scriptName}] ℹ️  managed 首次使用请在弹出窗口登录各招聘平台，登录态持久化到 ${MANAGED_USER_DATA_DIR}`);
        }
        return cdpUrl;
      }
      console.error(`[${scriptName}] ⚠️  自动启动失败（浏览器未就绪）`);
    } catch (e) {
      console.error(`[${scriptName}] ⚠️  自动启动失败：${e.message}`);
    }
  }

  // ── Step 3: 失败处理 ────────────────────────────────────────────────────────
  const startLines = launchMode === "managed"
    ? [
        `  managed 模式依赖 Playwright Chromium，请先安装后重跑：`,
        `  npx playwright install chromium`,
        `  （重跑会自动拉起浏览器，首次需在窗口内登录各平台）`,
      ]
    : process.platform === "win32"
    ? [
        `  请手动启动（Windows，命令提示符/PowerShell）：`,
        `  "${CHROME_PATH}" --user-data-dir="${USER_DATA_DIR}" --remote-debugging-port=9223 --no-first-run --no-default-browser-check`,
      ]
    : [
        `  请手动启动（macOS）：`,
        `  open -na "Google Chrome" --args \\`,
        `    --user-data-dir=${USER_DATA_DIR} \\`,
        `    --remote-debugging-port=9223 \\`,
        `    --no-first-run --no-default-browser-check`,
      ];
  const msg = [
    `\n[${scriptName}] ❌ 调试浏览器未运行（已扫描端口 ${FALLBACK_PORTS.join("/")}）`,
    ...startLines,
    "",
  ].join("\n");

  if (exitOnFail) {
    console.error(msg);
    process.exit(1);
  }

  console.error(msg.trim());
  return null;
}
