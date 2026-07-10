#!/usr/bin/env node
// auth-init.mjs — 招聘平台登录状态初始化工具
//
// 用法：
//   node scrapers/shared/auth-init.mjs                      # 检查全部平台（未登录则等待）
//   node scrapers/shared/auth-init.mjs --platform boss,liepin  # 只检查指定平台
//   node scrapers/shared/auth-init.mjs --check-only         # 只检查，未登录不等待直接报告
//
// 用途：
//   - 新用户首次使用前，一次性完成所有平台的登录初始化
//   - 换机或 Cookie 过期后重新登录
//   - 排查采集异常时快速诊断登录状态

import { ensureChrome } from "./ensure-chrome.mjs";
import { ensureLoggedIn } from "./check-login.mjs";

const ALL_PLATFORMS = ["boss", "zhaopin", "51job", "liepin"];

function parseArgs(argv) {
  const out = { platforms: ALL_PLATFORMS, checkOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--platform") {
      out.platforms = (argv[++i] || "").split(",").map(s => s.trim()).filter(Boolean);
    } else if (argv[i] === "--check-only") {
      out.checkOnly = true;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log([
        "用法:",
        "  node scrapers/shared/auth-init.mjs [选项]",
        "",
        "选项:",
        "  --platform <p1,p2>   只检查指定平台（可选：boss zhaopin 51job liepin）",
        "  --check-only         只检查状态，未登录时不等待，直接输出结果",
        "  --help               显示此帮助",
      ].join("\n"));
      process.exit(0);
    }
  }
  return out;
}

async function checkOnlyLogin(platform, cdpUrl) {
  const { extractCookiesAsString } = await import("./check-login.mjs");
  const DOMAIN_MAP = {
    boss: ".zhipin.com",
    zhaopin: ".zhaopin.com",
    "51job": ".51job.com",
    liepin: ".liepin.com",
  };
  const AUTH_COOKIES = {
    boss:    ["wt2", "__zp_stoken__"],
    zhaopin: ["at", "rt", "sess", "zp_token"],
    "51job": ["acw_sc__v2", "guid"],
    liepin:  ["lt_auth", "UniqueKey", "liepin_login_valid"],
  };
  const { rawCookies } = await extractCookiesAsString(cdpUrl, DOMAIN_MAP[platform]);
  const now = Date.now() / 1000;
  const ok = AUTH_COOKIES[platform].some(name =>
    rawCookies.some(c => c.name === name && c.value && (c.expires <= 0 || c.expires > now))
  );
  return ok;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cdpUrl = process.env.SCRAPER_CDP_URL || process.env.BOSS_CDP_URL || "http://127.0.0.1:9223";

  console.error("[auth-init] 启动调试 Chrome...");
  await ensureChrome({ scriptName: "auth-init" });
  console.error("[auth-init] Chrome 就绪\n");

  const results = [];

  for (const platform of opts.platforms) {
    if (opts.checkOnly) {
      process.stderr.write(`[auth-init] 检查 ${platform}... `);
      try {
        const ok = await checkOnlyLogin(platform, cdpUrl);
        process.stderr.write(ok ? "✅ 已登录\n" : "❌ 未登录\n");
        results.push({ platform, ok });
      } catch (err) {
        process.stderr.write(`⚠️  检查失败: ${err.message}\n`);
        results.push({ platform, ok: false, error: err.message });
      }
    } else {
      try {
        await ensureLoggedIn(platform, {
          cdpUrl,
          scriptName: "auth-init",
          skipVerify: false,
          loginTimeout: 10 * 60 * 1000, // 10 分钟等待上限
        });
        results.push({ platform, ok: true });
      } catch (err) {
        results.push({ platform, ok: false, error: err.message });
      }
    }
  }

  console.error("\n[auth-init] ── 汇总 ────────────────────────");
  const allOk = results.every(r => r.ok);
  for (const r of results) {
    const icon = r.ok ? "✅" : "❌";
    const note = r.error ? ` (${r.error})` : "";
    console.error(`  ${icon} ${r.platform}${note}`);
  }
  console.error("─────────────────────────────────────────");

  if (!allOk && !opts.checkOnly) {
    console.error("\n[auth-init] 部分平台登录失败，对应采集脚本将在启动时再次提示");
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: allOk, results }));
}

import { fileURLToPath } from "node:url";
import path from "node:path";
const _thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(_thisFile)) {
  main().catch(err => {
    console.error(`[auth-init] 致命错误: ${err.message}`);
    process.exit(1);
  });
}
