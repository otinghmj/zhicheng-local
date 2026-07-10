// 采集频率与退避统一层（D3）
//
// 收拢原本散落各脚本的"页间/滚动间隔"常量与"失败重试"逻辑：
//   - RATE_POLICY：每平台频率策略的唯一真值（对齐 SKILL.md 频率表），env 可覆盖
//   - pageDelay(platform)：返回该平台的随机页间/滚动间隔（毫秒）
//   - withBackoff(fn)：指数退避重试，只用于幂等读取调用（不用于有状态的滚动/导航）
//
// 兼容：pageDelay 仍优先读旧 env 变量（SCRAPER_PAGE_PAUSE_MS / BOSS_SCROLL_PAUSE_MS 等），
//       默认值来自 RATE_POLICY，旧用法不破坏。

import { setTimeout as sleep } from "node:timers/promises";

function dbg(...args) {
  if (process.env.SCRAPER_DEBUG) console.error("[rate-limit]", ...args);
}

// 每平台频率策略（唯一真值；单位毫秒）
export const RATE_POLICY = {
  liepin:  { pagePauseMs: 8_000, pageJitterMs: 7_000, interQueryMs: 180_000 },
  zhaopin: { pagePauseMs: 8_000, pageJitterMs: 7_000, interQueryMs: 120_000 },
  boss:    { pagePauseMs: 4_000, pageJitterMs: 2_000, interQueryMs: 180_000 },
  "51job": { pagePauseMs: 0,     pageJitterMs: 0,     interQueryMs: 120_000 },
};

// 各平台的旧 env 变量名（保留兼容，优先级高于策略默认值）
const PAUSE_ENV  = { liepin: "SCRAPER_PAGE_PAUSE_MS",  zhaopin: "SCRAPER_PAGE_PAUSE_MS",  boss: "BOSS_SCROLL_PAUSE_MS" };
const JITTER_ENV = { liepin: "SCRAPER_PAGE_JITTER_MS", zhaopin: "SCRAPER_PAGE_JITTER_MS", boss: "BOSS_SCROLL_JITTER_MS" };

/** 返回该平台一次页间/滚动等待的毫秒数（base + 随机抖动）。用法：await sleep(pageDelay('boss')) */
export function pageDelay(platform) {
  const policy   = RATE_POLICY[platform] || {};
  const pauseEnv = process.env[PAUSE_ENV[platform]];
  const jitEnv   = process.env[JITTER_ENV[platform]];
  const base   = Number(pauseEnv != null ? pauseEnv : (policy.pagePauseMs  ?? 0));
  const jitter = Number(jitEnv   != null ? jitEnv   : (policy.pageJitterMs ?? 0));
  return base + Math.random() * jitter;
}

/** 该平台查询间冷却时长（毫秒），env 可覆盖 */
export function interQueryMs(platform, envName) {
  const fromEnv = envName ? process.env[envName] : undefined;
  if (fromEnv != null) return Number(fromEnv);
  return (RATE_POLICY[platform] || {}).interQueryMs ?? 0;
}

/**
 * 指数退避重试。仅用于幂等读取调用（如 getPage / drain / JD 详情请求）。
 * 不要用于有状态的滚动/导航循环，避免重复副作用。
 *
 * @param {(attempt:number)=>Promise<any>} fn  执行体；抛错即触发重试
 * @param {object} opts
 * @param {number} opts.retries  额外重试次数（默认 3，即最多执行 4 次）
 * @param {number} opts.baseMs   退避基数（默认 2000）
 * @param {number} opts.maxMs    单次退避上限（默认 60000）
 * @param {string} opts.label    日志标签
 */
export async function withBackoff(fn, { retries = 3, baseMs = 2000, maxMs = 60_000, label = "call" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = Math.min(maxMs, baseMs * 2 ** attempt) + Math.random() * baseMs;
      dbg(`${label} 第 ${attempt + 1} 次失败：${err?.message || err}，${(delay / 1000).toFixed(1)}s 后重试`);
      await sleep(delay);
    }
  }
  throw lastErr;
}
