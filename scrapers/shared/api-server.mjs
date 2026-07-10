#!/usr/bin/env node

import http from "node:http";
import https from "node:https";
import process from "node:process";
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import zlib from "node:zlib";

const PORT = Number(process.env.SCRAPER_API_PORT || process.env.BOSS_API_PORT || 3337);
const API_KEY = String(process.env.BOSS_API_KEY || "").trim();
const DEFAULT_COOKIE = String(process.env.BOSS_COOKIE || "").trim();
const DEFAULT_CDP_URL = String(process.env.SCRAPER_CDP_URL || process.env.BOSS_CDP_URL || "http://127.0.0.1:9223").trim();
const INSECURE_TLS = process.env.BOSS_API_INSECURE_TLS === "1";
// D1：门控调试日志——仅当 SCRAPER_DEBUG 为真时输出，用于暴露"真会丢职位"的静默解析失败
const dbg = (...args) => { if (process.env.SCRAPER_DEBUG) console.error("[dbg]", ...args); };
const MAX_BODY_BYTES = 64 * 1024;
const SEARCH_ALL_MAX_PAGES_HARD = 3;
const SEARCH_ALL_DEFAULT_PAGE_PAUSE_MS = Number(process.env.BOSS_SEARCH_ALL_PAGE_PAUSE_MS || 10 * 60 * 1000);
const SEARCH_ALL_FAILURE_RESTART_DELAY_MS = Number(process.env.BOSS_SEARCH_ALL_FAILURE_RESTART_DELAY_MS || 10 * 60 * 1000);
const SEARCH_ALL_MAX_RESTARTS = Number(process.env.BOSS_SEARCH_ALL_MAX_RESTARTS || 1);
const execFileAsync = promisify(execFile);

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQ = Number(process.env.BOSS_API_RATE_LIMIT_MAX_REQ || 2);
const rateBuckets = new Map();
const DETAIL_RATE_MIN_MS = Number(process.env.BOSS_DETAIL_RATE_MIN_MS || 10 * 60 * 1000);
const DETAIL_RATE_MAX_MS = Number(process.env.BOSS_DETAIL_RATE_MAX_MS || 30 * 60 * 1000);
let nextDetailAllowedAt = 0;
let lastDetailCooldownMs = 0;

// CDP network capture sessions (listen + drain flow for joblist.json interception)
const _captureSessions = new Map();
let _captureSessionCounter = 0;

// Zhaopin CDP capture sessions (listen + drain + replay flow)
const _zhaopinSessions = new Map();
let _zhaopinSessionCounter = 0;

function unique(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean))];
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function getClientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "");
  if (xff) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function allowRate(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const kept = bucket.filter((ts) => now - ts <= RATE_LIMIT_WINDOW_MS);
  kept.push(now);
  rateBuckets.set(ip, kept);
  return kept.length <= RATE_LIMIT_MAX_REQ;
}

function randomInt(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function reserveDetailSlot() {
  const now = Date.now();
  if (now < nextDetailAllowedAt) {
    return {
      ok: false,
      retryAfterMs: nextDetailAllowedAt - now,
      nextAllowedAt: new Date(nextDetailAllowedAt).toISOString(),
      lastCooldownMs: lastDetailCooldownMs
    };
  }

  const minMs = Math.max(0, DETAIL_RATE_MIN_MS);
  const maxMs = Math.max(minMs, DETAIL_RATE_MAX_MS);
  lastDetailCooldownMs = randomInt(minMs, maxMs);
  nextDetailAllowedAt = now + lastDetailCooldownMs;
  return {
    ok: true,
    cooldownMs: lastDetailCooldownMs,
    nextAllowedAt: new Date(nextDetailAllowedAt).toISOString()
  };
}

function maskCookie(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.length <= 24) return "***";
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function maskSensitiveValue(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.length <= 16) return "***";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function sanitizeCapturedHeaders(input) {
  const source = input && typeof input === "object" ? input : {};
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    const lower = String(key || "").toLowerCase();
    if (lower === "cookie") {
      output[key] = maskCookie(value);
    } else if (lower.includes("token") || lower.includes("authorization")) {
      output[key] = maskSensitiveValue(value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function getApiKey(req) {
  const fromHeader = String(req.headers["x-api-key"] || "").trim();
  if (fromHeader) return fromHeader;
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function checkAuth(req) {
  if (!API_KEY) return true;
  return getApiKey(req) === API_KEY;
}

function safeNumber(input, fallback) {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeArray(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => String(item || "").trim()).filter(Boolean);
}

function textIncludesAny(value, keywords) {
  const text = String(value || "").toLowerCase();
  if (!keywords.length) return true;
  return keywords.some((word) => text.includes(String(word).toLowerCase()));
}

function textExcludesAll(value, keywords) {
  const text = String(value || "").toLowerCase();
  if (!keywords.length) return true;
  return keywords.every((word) => !text.includes(String(word).toLowerCase()));
}

function parseSalaryRangeK(salaryDesc) {
  const text = String(salaryDesc || "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*K/i);
  if (!match) return null;
  return {
    minK: Number(match[1]),
    maxK: Number(match[2])
  };
}

function parseExperienceRangeYears(expText) {
  const text = String(expText || "");
  if (!text || text.includes("不限")) return null;
  const range = text.match(/(\d+)\s*-\s*(\d+)\s*年/);
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }
  const single = text.match(/(\d+)\s*年/);
  if (single) {
    const years = Number(single[1]);
    return { min: years, max: years };
  }
  return null;
}

function normalizeDegree(degree) {
  const text = String(degree || "").trim();
  if (!text) return "不限";
  if (text.includes("不限")) return "不限";
  return text;
}

function degreeRank(degree) {
  const map = new Map([
    ["不限", 0],
    ["中专/中技", 1],
    ["高中", 1],
    ["大专", 2],
    ["本科", 3],
    ["硕士", 4],
    ["博士", 5]
  ]);
  return map.get(normalizeDegree(degree)) ?? 0;
}

function normalizeFilters(rawFilters = {}) {
  return {
    keywordInclude: normalizeArray(rawFilters.keywordInclude),
    keywordExclude: normalizeArray(rawFilters.keywordExclude),
    jobTypeIn: Array.isArray(rawFilters.jobTypeIn)
      ? rawFilters.jobTypeIn.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [],
    salaryMinK: rawFilters.salaryMinK == null ? null : safeNumber(rawFilters.salaryMinK, null),
    salaryMaxK: rawFilters.salaryMaxK == null ? null : safeNumber(rawFilters.salaryMaxK, null),
    degreeAtLeast: rawFilters.degreeAtLeast ? normalizeDegree(rawFilters.degreeAtLeast) : "",
    expMinYears: rawFilters.expMinYears == null ? null : safeNumber(rawFilters.expMinYears, null),
    expMaxYears: rawFilters.expMaxYears == null ? null : safeNumber(rawFilters.expMaxYears, null),
    companyScaleInclude: normalizeArray(rawFilters.companyScaleInclude),
    companyScaleExclude: normalizeArray(rawFilters.companyScaleExclude),
    industryInclude: normalizeArray(rawFilters.industryInclude),
    industryExclude: normalizeArray(rawFilters.industryExclude)
  };
}

function matchJobFilters(job, filters) {
  const title = String(job?.jobName || "");
  if (!textIncludesAny(title, filters.keywordInclude)) return false;
  if (!textExcludesAll(title, filters.keywordExclude)) return false;

  if (filters.jobTypeIn.length > 0) {
    const jt = Number(job?.jobType);
    if (!Number.isFinite(jt) || !filters.jobTypeIn.includes(jt)) return false;
  }

  const salaryRange = parseSalaryRangeK(job?.salaryDesc || "");
  if (filters.salaryMinK != null) {
    if (!salaryRange || salaryRange.maxK < filters.salaryMinK) return false;
  }
  if (filters.salaryMaxK != null) {
    if (!salaryRange || salaryRange.minK > filters.salaryMaxK) return false;
  }

  if (filters.degreeAtLeast) {
    if (degreeRank(job?.jobDegree) < degreeRank(filters.degreeAtLeast)) return false;
  }

  const expRange = parseExperienceRangeYears(job?.jobExperience || "");
  if (filters.expMinYears != null) {
    if (!expRange || expRange.max < filters.expMinYears) return false;
  }
  if (filters.expMaxYears != null) {
    if (!expRange || expRange.min > filters.expMaxYears) return false;
  }

  if (!textIncludesAny(job?.brandScaleName || "", filters.companyScaleInclude)) return false;
  if (!textExcludesAll(job?.brandScaleName || "", filters.companyScaleExclude)) return false;
  if (!textIncludesAny(job?.brandIndustry || "", filters.industryInclude)) return false;
  if (!textExcludesAll(job?.brandIndustry || "", filters.industryExclude)) return false;

  return true;
}

function normalizeJob(item = {}) {
  return {
    jobName: item.jobName || "",
    salaryDesc: item.salaryDesc || "",
    cityName: item.cityName || "",
    areaDistrict: item.areaDistrict || "",
    businessDistrict: item.businessDistrict || "",
    jobExperience: item.jobExperience || "",
    jobDegree: item.jobDegree || "",
    brandName: item.brandName || "",
    brandScaleName: item.brandScaleName || "",
    brandIndustry: item.brandIndustry || "",
    jobType: item.jobType ?? null,
    welfareList: Array.isArray(item.welfareList) ? item.welfareList : [],
    encryptJobId: item.encryptJobId || "",
    securityId: item.securityId || "",
    jobValidStatus: item.jobValidStatus ?? null
  };
}

async function parseBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("请求体过大，超过 64KB");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function buildHeaders({ cookie, referer, xRequestedWith = true }) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    Referer: referer
  };
  if (xRequestedWith) {
    headers["X-Requested-With"] = "XMLHttpRequest";
  }
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

async function callBossJson(url, options) {
  const target = new URL(url);
  const isHttps = target.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(target, {
      method: options.method || "GET",
      headers: options.headers || {},
      rejectUnauthorized: !INSECURE_TLS
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { parseError: true, rawText: text.slice(0, 2000) };
        }
        resolve({
          httpStatus: Number(res.statusCode || 0),
          data: parsed
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

async function callBossText(url, options, redirectsLeft = 5) {
  const target = new URL(url);
  const isHttps = target.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(target, {
      method: options.method || "GET",
      headers: options.headers || {},
      rejectUnauthorized: !INSECURE_TLS
    }, async (res) => {
      const status = Number(res.statusCode || 0);
      const location = String(res.headers.location || "");
      if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
        const nextUrl = new URL(location, target).toString();
        try {
          const nested = await callBossText(nextUrl, options, redirectsLeft - 1);
          return resolve(nested);
        } catch (error) {
          return reject(error);
        }
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          httpStatus: status,
          finalUrl: target.toString(),
          headers: res.headers,
          text: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function callWithRetry(makeRequest, maxRetries = 1, retryDelayMs = SEARCH_ALL_FAILURE_RESTART_DELAY_MS) {
  let lastError = null;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await makeRequest();
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        await sleep(retryDelayMs);
      }
    }
  }
  throw lastError;
}

function resolveCookie(body) {
  const bodyCookie = String(body?.cookie || "").trim();
  const cookie = bodyCookie || DEFAULT_COOKIE;
  return cookie;
}

async function fetchCdpWebSocketUrl(cdpUrl) {
  const response = await fetch(`${cdpUrl}/json/version`);
  if (!response.ok) {
    throw new Error(`CDP version request failed: ${response.status}`);
  }
  const payload = await response.json();
  const wsUrl = String(payload?.webSocketDebuggerUrl || "").trim();
  if (!wsUrl) {
    throw new Error("CDP version response missing webSocketDebuggerUrl");
  }
  return wsUrl;
}

async function callCdpMethod(cdpUrl, method, params = {}) {
  const wsUrl = await fetchCdpWebSocketUrl(cdpUrl);

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch { }
      reject(new Error(`CDP method timeout: ${method}`));
    }, 8000);

    const cleanup = () => clearTimeout(timer);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method,
        params
      }));
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data || ""));
        if (payload.id !== 1) return;
        cleanup();
        socket.close();
        if (payload.error) {
          reject(new Error(`CDP ${method} failed: ${payload.error.message || JSON.stringify(payload.error)}`));
          return;
        }
        resolve(payload.result || {});
      } catch (error) {
        cleanup();
        try {
          socket.close();
        } catch { }
        reject(error);
      }
    });

    socket.addEventListener("error", (event) => {
      cleanup();
      reject(new Error(`CDP websocket error for ${method}: ${String(event?.message || "unknown")}`));
    });
  });
}

async function callTargetCdpMethod(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch { }
      reject(new Error(`Target CDP method timeout: ${method}`));
    }, 12000);

    const cleanup = () => clearTimeout(timer);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method,
        params
      }));
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data || ""));
        if (payload.id !== 1) return;
        cleanup();
        socket.close();
        if (payload.error) {
          reject(new Error(`Target CDP ${method} failed: ${payload.error.message || JSON.stringify(payload.error)}`));
          return;
        }
        resolve(payload.result || {});
      } catch (error) {
        cleanup();
        try {
          socket.close();
        } catch { }
        reject(error);
      }
    });

    socket.addEventListener("error", (event) => {
      cleanup();
      reject(new Error(`Target CDP websocket error for ${method}: ${String(event?.message || "unknown")}`));
    });
  });
}

function joinCookieHeader(cookies) {
  return cookies
    .filter((cookie) => cookie?.name)
    .map((cookie) => `${cookie.name}=${cookie.value ?? ""}`)
    .join("; ");
}

async function extractBossCookiesFromCdp(cdpUrl) {
  const result = await callCdpMethod(cdpUrl, "Storage.getCookies", {});
  const allCookies = Array.isArray(result?.cookies) ? result.cookies : [];
  const bossCookies = allCookies.filter((cookie) => {
    const domain = String(cookie?.domain || "");
    return domain.includes("zhipin.com");
  });
  return {
    cdpUrl,
    cookieCount: bossCookies.length,
    cookieHeader: joinCookieHeader(bossCookies)
  };
}

async function tryReadFrontChromeTab() {
  // C3：AppleScript 仅 macOS 可用。非 Mac 直接返回空，由 findFrontBossPageTarget
  // 回退到按 zhipin.com 网址匹配标签页（功能不受影响，只是少了这个 URL 提示）。
  if (process.platform !== "darwin") {
    return { found: false, title: "", url: "" };
  }
  const script = `
set output to ""
tell application "Google Chrome"
  if it is running then
    set winCount to count of windows
    if winCount > 0 then
      set t to title of active tab of front window
      set u to URL of active tab of front window
      set output to (t & linefeed & u)
    end if
  end if
end tell
return output
`;
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      maxBuffer: 1024 * 256
    });
    const lines = String(stdout || "").split(/\r?\n/);
    const title = String(lines[0] || "").trim();
    const url = String(lines[1] || "").trim();
    if (!title && !url) {
      return {
        found: false,
        title: "",
        url: ""
      };
    }
    return {
      found: true,
      title,
      url
    };
  } catch {
    return {
      found: false,
      title: "",
      url: ""
    };
  }
}

// ── Zhaopin helpers ──────────────────────────────────────────────────────────

// 检测响应体中是否为智联职位列表，返回 jobs 数组（空数组表示非职位列表）
function extractZhaopinJobs(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data?.data?.results))  return data.data.results;
  if (Array.isArray(data?.data?.list))     return data.data.list;
  if (Array.isArray(data?.results))        return data.results;
  if (Array.isArray(data?.list))           return data.list;
  if (Array.isArray(data?.data))           return data.data;
  return [];
}

function extractZhaopinTotal(data) {
  return Number(
    data?.data?.numFound ?? data?.data?.total ?? data?.data?.count ??
    data?.numFound ?? data?.total ?? data?.count ?? 0
  );
}

// ── Zhaopin: JS-state extractor via Runtime.evaluate ────────────────────────
// 智联搜索结果通过 SSR 注水写入 window.__INITIAL_STATE__，用 CDP JS 注入读取，
// 比 Network.getResponseBody 更可靠（跨域响应体 Chrome 不缓存）。
async function zhaopinGetPageState(wsUrl, pageUrl, timeoutMs) {
  timeoutMs = timeoutMs || 22000;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error("zhaopinGetPageState timeout")); }
    }, timeoutMs);

    const rpc = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      try { ws.send(JSON.stringify({ id, method, params: params || {} })); }
      catch (e) { pending.delete(id); rej(e); }
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(result);
    };

    ws.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message || JSON.stringify(m.error)));
        else res(m.result);
      }
    });

    ws.addEventListener("error", () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error("WebSocket error in zhaopinGetPageState")); }
    });

    ws.addEventListener("open", async () => {
      try {
        await rpc("Page.enable", {});
        await rpc("Runtime.enable", {});

        if (pageUrl) {
          await rpc("Page.navigate", { url: pageUrl });
        }

        // 轮询直到 readyState=complete 且 positionList 有数据
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const r = await rpc("Runtime.evaluate", {
            expression: "(document.readyState === 'complete' ? '1' : '0') + '|' + (window.__INITIAL_STATE__?.positionList?.length || 0)",
            returnByValue: true
          });
          const [ready, len] = String(r?.result?.value || "0|0").split("|");
          if (ready === "1" && Number(len) > 0) break;
        }

        const extracted = await rpc("Runtime.evaluate", {
          expression: `(()=>{
            const s = window.__INITIAL_STATE__ || {};
            const list = s.positionList || [];
            return JSON.stringify({
              positionList: list,
              positionCount: Number(s.positionCount) || list.length,
              pages:         Number(s.pages)         || 0,
              pageSize:      Number(s.pageSize)      || list.length,
              pageIndex:     Number(s.pageIndex)     || 1,
              currentUrl:    location.href
            });
          })()`,
          returnByValue: true
        });

        const data = JSON.parse(extracted?.result?.value || "{}");
        finish({ ok: true, ...data });
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(err); }
      }
    });
  });
}

// 增量翻页：将 URL 中的页码参数替换为 targetPage（1-based）
function buildZhaopinPageUrl(originalUrl, targetPage) {
  let url;
  try { url = new URL(originalUrl); } catch { return originalUrl; }

  // 路径式翻页：/sou/jl763/kw.../p1  → /sou/jl763/kw.../p{N}
  const pathPageMatch = url.pathname.match(/^(.*\/p)(\d+)(\/.*)?$/);
  if (pathPageMatch) {
    url.pathname = `${pathPageMatch[1]}${targetPage}${pathPageMatch[3] || ""}`;
    return url.toString();
  }

  // Query 参数式翻页
  if (url.searchParams.has("p")) {
    url.searchParams.set("p", String(targetPage));
    return url.toString();
  }
  if (url.searchParams.has("pageNum")) {
    url.searchParams.set("pageNum", String(targetPage));
    return url.toString();
  }
  if (url.searchParams.has("page")) {
    url.searchParams.set("page", String(targetPage));
    return url.toString();
  }
  if (url.searchParams.has("start") && url.searchParams.has("pageSize")) {
    const ps = Number(url.searchParams.get("pageSize")) || 60;
    url.searchParams.set("start", String((targetPage - 1) * ps));
    return url.toString();
  }
  // 兜底：追加 p 参数
  url.searchParams.set("p", String(targetPage));
  return url.toString();
}

// 用捕获的请求模板直接发起 HTTP/HTTPS 请求（用于翻页 replay）
async function replayZhaopinRequest(template, targetPage) {
  const pageUrl = buildZhaopinPageUrl(template.url, targetPage);
  const target = new URL(pageUrl);
  const isHttps = target.protocol === "https:";
  const client = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(target, {
      method: template.method || "GET",
      headers: template.headers || {},
      rejectUnauthorized: !INSECURE_TLS
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let text;
        try {
          text = (buf[0] === 0x1f && buf[1] === 0x8b)
            ? zlib.gunzipSync(buf).toString("utf8")
            : buf.toString("utf8");
        } catch {
          text = buf.toString("utf8");
        }
        let data;
        try { data = JSON.parse(text); } catch { data = null; }
        resolve({ httpStatus: Number(res.statusCode || 0), data, pageUrl });
      });
    });
    req.on("error", reject);
    if (template.method === "POST" && template.postData) {
      req.write(template.postData);
    }
    req.end();
  });
}

async function findFrontZhaopinPageTarget(cdpUrl) {
  const response = await fetch(`${cdpUrl}/json/list`);
  if (!response.ok) throw new Error(`CDP list request failed: ${response.status}`);
  const targets = await response.json();
  const pages = (Array.isArray(targets) ? targets : []).filter((t) => t?.type === "page");
  // 优先匹配搜索结果页（支持两种域名格式）
  const souNew = pages.find((t) => String(t.url || "").includes("zhaopin.com/sou"));
  if (souNew?.webSocketDebuggerUrl) return souNew;
  const souOld = pages.find((t) => String(t.url || "").includes("sou.zhaopin.com"));
  if (souOld?.webSocketDebuggerUrl) return souOld;
  const any = pages.find((t) => String(t.url || "").includes("zhaopin.com"));
  if (any?.webSocketDebuggerUrl) return any;
  return null;
}

// ── end Zhaopin helpers ──────────────────────────────────────────────────────

// ── 猎聘（Liepin）helpers ────────────────────────────────────────────────────
//
// 目标：www.liepin.com/zhaopin/（候选人搜索页，无需登录）
// URL 格式：https://www.liepin.com/zhaopin/?key={keyword}&dq={city}&curPage={N}
//   dq 参数使用电话区号（010=北京、021=上海、020=广州等），全国留空或 dq=000
//
// 实测 DOM 结构（2026-05）：
//   卡片容器：div.job-detail-box（stable class，另有哈希 class 会变）
//   innerText 行格式：职位名 / 【 / 城市-区 / 】 / [急聘] / 薪资 / 年限 / 学历 / 公司 / 行业 / 规模
//   分页：URL 参数 curPage=N（0-indexed）

const LIEPIN_DOM_EXTRACT = `(()=>{
  // SSR 优先（React 水合数据，字段完整）
  try {
    const d = window.__INITIAL_DATA__ || window.__INITIAL_STATE__ || window.__SSR_DATA__ || null;
    if (d) {
      const list = (d.data?.list || d.data?.jobList || d.list || d.jobList) || [];
      if (list.length > 0) {
        const total    = Number(d.data?.total    || d.total    || 0);
        const pageSize = Number(d.data?.pageSize || d.pageSize || 40);
        const curPage  = Number(d.data?.curPage  || d.curPage  || 0);
        const pages    = total && pageSize ? Math.ceil(total / pageSize) : 0;
        return JSON.stringify({ ok:true, source:'ssr', rawList:list, total, pageSize, curPage, pages, currentUrl:location.href });
      }
    }
  } catch(e) {}

  // DOM 提取：www.liepin.com/zhaopin/ 实测卡片选择器
  const cards = [...document.querySelectorAll('.job-detail-box')];
  if (!cards.length) {
    return JSON.stringify({ ok:false, reason:'no-cards', url:location.href, title:document.title });
  }

  // 解析一张卡片的 innerText，兼容两种格式：
  //   正常格式（多行）：职位 / 【 / 城市 / 】 / [急聘] / 薪资 / 年限 / 学历 / 公司 / 行业规模
  //   紧凑格式（推广位，一行）："职位【城市】薪资年限学历公司行业规模"
  function parseCard(el) {
    const rawUrl  = el.querySelector('a')?.href || '';
    const url     = rawUrl ? rawUrl.split('?')[0] : '';
    // 从 URL 提取 jobId（格式：/job/xxx.shtml 或 /a/xxx.shtml），避免 dedup 退化
    const jobIdM  = url.match(/\\/(?:job|a)\\/(\\d+)\\.shtml/);
    const jobId   = jobIdM ? jobIdM[1] : '';
    const raw    = el.innerText || '';
    const lines  = raw.split('\\n').map(s => s.trim()).filter(Boolean);

    let jobName='', cityName='', rest=[];

    if (lines.length > 1) {
      // 正常多行格式
      const bi = lines.indexOf('【');
      const ei = lines.indexOf('】');
      jobName  = bi > 0 ? lines.slice(0, bi).join('') : (lines[0] || '');
      cityName = (bi >= 0 && ei > bi) ? lines.slice(bi + 1, ei).join('') : '';
      rest     = ei >= 0 ? lines.slice(ei + 1) : lines.slice(1);
    } else {
      // 紧凑一行格式（推广位）：用正则拆分
      const m = (lines[0] || '').match(/^(.+?)【(.+?)】(.*)$/);
      if (m) {
        jobName  = m[1].trim();
        cityName = m[2].trim();
        // 剩余部分按已知字段顺序切割（薪资/年限/学历/公司/行业规模连排，无分隔符）
        // 只保留能可靠提取的字段，其余留空
        const tail = m[3];
        const salM = tail.match(/(\\d+[-~]\\d+[kK](?:·\\d+薪)?|面议|面谈)/);
        const expM = tail.match(/(\\d+年以上|\\d+-\\d+年|经验不限)/);
        const degM = tail.match(/(统招本科|本科|大专|硕士|博士|高中|学历不限)/);
        rest = [salM?.[1]||'', expM?.[1]||'', degM?.[1]||''].filter(Boolean);
        // 公司名：行业规模前的文字，较难可靠提取，留空
      } else {
        jobName = lines[0] || '';
      }
    }

    const salaryDesc    = rest.find(l => /\\d+[kK]|面议|面谈/.test(l)) || '';
    const jobExperience = rest.find(l => /年/.test(l) && !/^\\d{4}/.test(l)) || '';
    const jobDegree     = rest.find(l => /本科|大专|硕士|博士|高中|学历|统招/.test(l)) || '';
    const brandName     = rest.find(l =>
      l && l !== '【' && l !== '】' &&
      !/\\d+[kK]|面议/i.test(l) && !/年/.test(l) &&
      !/经验/.test(l) &&
      !/本科|大专|硕士|博士|高中|学历|统招/.test(l) &&
      !/^急聘|热招|紧急/.test(l)
    ) || '';

    // 行业+规模在同一行（innerText 内联合并），按人数关键词切割
    const bni = rest.indexOf(brandName);
    const combined = bni >= 0 ? (rest[bni + 1] || '') : '';
    const scaleM = combined.match(/(\\d+[-~]\\d+人|\\d+人以上|\\d+人以下|\\d+人)/);
    const brandIndustry  = scaleM ? combined.slice(0, combined.lastIndexOf(scaleM[1])).trim() : combined;
    const brandScaleName = scaleM ? scaleM[1] : '';

    return { url, jobId, jobName, brandName, salaryDesc, cityName, jobExperience, jobDegree,
             brandIndustry, brandScaleName, brandStageName:'', skills:[], welfareList:[], jobLabels:[] };
  }

  const jobs = cards.map(parseCard).filter(j => j.url || j.jobName);

  // 分页：Ant Design 分页器，类名格式为 ant-pagination-item-{N}
  const params     = new URLSearchParams(location.search);
  const curPage    = Number(params.get('curPage') || '0');
  const pgItems    = [...document.querySelectorAll('li.ant-pagination-item')];
  const pgNums     = pgItems.map(li => {
    const m = li.className.match(/ant-pagination-item-(\\d+)/);
    return m ? Number(m[1]) : 0;
  }).filter(n => n > 0);
  const totalPages = pgNums.length ? Math.max(...pgNums) : 0;

  return JSON.stringify({ ok:true, source:'dom', rawList:jobs, totalPages, curPage, currentUrl:location.href });
})()`;

async function liepinGetPageState(wsUrl, pageUrl, timeoutMs) {
  timeoutMs = timeoutMs || 25000;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error("liepinGetPageState timeout")); }
    }, timeoutMs);

    const rpc = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      try { ws.send(JSON.stringify({ id, method, params: params || {} })); }
      catch (e) { pending.delete(id); rej(e); }
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(result);
    };

    ws.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message || JSON.stringify(m.error)));
        else res(m.result);
      }
    });

    ws.addEventListener("error", () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error("WebSocket error in liepinGetPageState")); }
    });

    ws.addEventListener("open", async () => {
      try {
        await rpc("Page.enable", {});
        await rpc("Runtime.enable", {});

        if (pageUrl) {
          await rpc("Page.navigate", { url: pageUrl });
        }

        // 轮询：等待 .job-detail-box 出现，且 location.search 与目标 URL 匹配。
        // 猎聘是 SPA，Page.navigate 后 readyState 很快变 complete，
        // 但 React 重渲染需要额外时间。不检查 URL 会导致读到上一页的旧 DOM。
        const targetSearch = pageUrl ? new URL(pageUrl).search : "";
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const r = await rpc("Runtime.evaluate", {
            expression: `(document.readyState==='complete'?'1':'0')+'|'+document.querySelectorAll('.job-detail-box').length+'|'+location.search`,
            returnByValue: true
          });
          const parts = String(r?.result?.value || "0|0|").split("|");
          const [ready, cnt, curSearch] = [parts[0], parts[1], parts.slice(2).join("|")];
          const urlOk = !targetSearch || curSearch === targetSearch;
          if (ready === "1" && Number(cnt) > 0 && urlOk) break;
          if (ready === "1" && i > 25 && urlOk) break; // 加载完但无结果（如最后一页）
        }

        const extracted = await rpc("Runtime.evaluate", {
          expression: LIEPIN_DOM_EXTRACT,
          returnByValue: true
        });

        const data = JSON.parse(extracted?.result?.value || "{}");
        finish(data);
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(err); }
      }
    });
  });
}

async function findFrontLiepinPageTarget(cdpUrl) {
  const response = await fetch(`${cdpUrl}/json/list`);
  if (!response.ok) throw new Error(`CDP list request failed: ${response.status}`);
  const targets = await response.json();
  const pages = (Array.isArray(targets) ? targets : []).filter((t) => t?.type === "page");
  // 优先匹配搜索结果页
  const zhaopin = pages.find((t) => String(t.url || "").includes("liepin.com/zhaopin"));
  if (zhaopin?.webSocketDebuggerUrl) return zhaopin;
  // 兜底：任意猎聘页面
  const any = pages.find((t) => String(t.url || "").includes("liepin.com"));
  if (any?.webSocketDebuggerUrl) return any;
  return null;
}

// ── Liepin 纯接口模式（无需浏览器/CDP）────────────────────────────────────────
//
// 流程：
//   1. GET www.liepin.com/zhaopin/ → 提取 Set-Cookie（含 XSRF-TOKEN）
//   2. POST api-c.liepin.com/api/com.liepin.searchfront4c.pc-search-job
//      携带 Cookie + X-Fscp-* 请求头 + 搜索条件
//   3. 解析 data.data.jobCardList + data.pagination
//
// 返回格式与 DOM 模式一致（rawList / totalPages / curPage），
// 但字段更完整（公司规模/行业/薪资等均有独立字段）。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 对猎聘 HTTP API 发起 HTTPS 请求，遵循全局 INSECURE_TLS 设置。
 */
function liepinHttpReq(method, host, path, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      hostname: host,
      path,
      headers,
      rejectUnauthorized: !INSECURE_TLS,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * 访问猎聘搜索页面，返回其设置的 Cookie 字符串（含 XSRF-TOKEN）。
 */
async function liepinGetCookies(dq) {
  const path = `/zhaopin/?key=&dq=${encodeURIComponent(dq)}&curPage=0`;
  const resp = await liepinHttpReq("GET", "www.liepin.com", path, {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9",
  }, null);

  // 提取所有 Set-Cookie 值（Node.js http 模块把多个 set-cookie 合并到数组）
  const rawCookies = Array.isArray(resp.headers["set-cookie"])
    ? resp.headers["set-cookie"]
    : (resp.headers["set-cookie"] ? [resp.headers["set-cookie"]] : []);

  let cookieJar = "";
  let xsrfToken = "";
  for (const c of rawCookies) {
    const [nameVal] = c.split(";");
    cookieJar += (cookieJar ? "; " : "") + nameVal.trim();
    const [name, ...rest] = nameVal.split("=");
    if (name.trim() === "XSRF-TOKEN") xsrfToken = rest.join("=").trim();
  }
  return { cookieJar, xsrfToken };
}

function liepinGenTraceId() {
  const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${hex()}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}

/**
 * 调用猎聘搜索接口，返回归一化后的职位列表 + 分页信息。
 */
async function liepinApiSearchPage({ query, city, page = 0, cookieJar = "", xsrfToken = "" }) {
  const pageUrl = `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(query)}&dq=${encodeURIComponent(city)}&curPage=${page}`;
  const bodyObj = {
    data: {
      mainSearchPcConditionForm: {
        city, dq: city, pubTime: "", currentPage: page, pageSize: 40,
        key: query, suggestTag: "", workYearCode: "", compId: "", compName: "",
        compTag: "", industry: "", salaryCode: "", jobKind: "", compScale: "",
        compKind: "", compStage: "", eduLevel: "", salaryLow: "", salaryHigh: "",
      },
      passThroughForm: { scene: page === 0 ? "init" : "page", skId: "", fkId: "", ckId: "", suggest: null },
    },
  };
  const bodyStr = JSON.stringify(bodyObj);
  const resp = await liepinHttpReq("POST", "api-c.liepin.com", "/api/com.liepin.searchfront4c.pc-search-job", {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json, text/plain, */*",
    "Content-Length": Buffer.byteLength(bodyStr, "utf8").toString(),
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Referer": "https://www.liepin.com/",
    "Origin": "https://www.liepin.com",
    "Cookie": cookieJar,
    "X-XSRF-TOKEN": xsrfToken,
    "X-Fscp-Std-Info": JSON.stringify({ client_id: "40108" }),
    "X-Fscp-Fe-Version": "",
    "X-Fscp-Trace-Id": liepinGenTraceId(),
    "X-Fscp-Bi-Stat": JSON.stringify({ location: pageUrl }),
    "X-Client-Type": "web",
    "X-Requested-With": "XMLHttpRequest",
    "X-Fscp-Version": "1.1",
  }, bodyStr);

  let raw;
  try { raw = JSON.parse(resp.body); } catch { throw new Error(`Liepin API JSON parse error: ${resp.body.slice(0, 200)}`); }
  if (!raw?.flag || raw.flag !== 1) {
    throw new Error(`Liepin API error flag=${raw?.flag} code=${raw?.code} msg=${raw?.msg}`);
  }

  const inner = raw.data?.data || {};
  const pg    = raw.data?.pagination || {};
  const cards = Array.isArray(inner.jobCardList) ? inner.jobCardList : [];

  // 归一化为标准字段
  const rawList = cards.map((card) => {
    const j = card.job || {};
    const c = card.comp || {};
    const url = String(j.link || "");
    const jobId = String(j.jobId || j.g || "");
    return {
      url,
      encryptJobId:     jobId,
      jobName:          String(j.title || ""),
      brandName:        String(c.compName || ""),
      salaryDesc:       String(j.salary || ""),
      cityName:         String(j.dq || ""),
      areaDistrict:     String(j.dq || "").split("-").slice(1).join("-"),
      businessDistrict: "",
      jobExperience:    String(j.requireWorkYears || ""),
      jobDegree:        String(j.requireEduLevel || ""),
      brandIndustry:    String(c.compIndustry || ""),
      brandScaleName:   String(c.compScale || ""),
      brandStageName:   String(c.compStage || ""),
      skills:           Array.isArray(j.skills) ? j.skills : [],
      welfareList:      Array.isArray(j.welfare) ? j.welfare : [],
      jobLabels:        Array.isArray(j.labels) ? j.labels.map((l) => String(l?.name || l)) : [],
    };
  });

  return {
    ok:         true,
    source:     "api",
    rawList,
    total:      Number(pg.totalCounts || 0),
    totalPages: Number(pg.totalPage || 0),
    pageSize:   Number(pg.pageSize || 40),
    curPage:    Number(pg.currentPage ?? page),
    hasNext:    pg.hasNext === true,
  };
}

/**
 * 获取猎聘职位详情（JD）。
 * 直接 HTTP GET 职位页面（SSR 渲染，无需浏览器），解析关键字段。
 *
 * @param {string} jobUrl  - 职位 URL，如 https://www.liepin.com/job/1978071197.shtml
 * @returns {{ ok, url, jobName, brandName, salaryDesc, cityName, jobExperience, jobDegree,
 *             brandIndustry, brandScaleName, jd, companyIntro }}
 */
async function liepinFetchJobDetail(jobUrl) {
  const parsed = new URL(jobUrl);
  const resp = await liepinHttpReq("GET", parsed.hostname, parsed.pathname + (parsed.search || ""), {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Cache-Control": "no-cache",
  }, null);

  if (resp.status !== 200) {
    throw new Error(`HTTP ${resp.status} on ${jobUrl}`);
  }

  const html = resp.body;

  // ── 工具函数 ──────────────────────────────────────────────────────────────
  const stripTags = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const unescape  = (s) => s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");

  // ── meta description（含薪资、学历、经验摘要）──────────────────────────────
  const metaDesc = (() => {
    const m = html.match(/<meta name="description" content="([^"]+)"/);
    return m ? unescape(m[1]) : "";
  })();

  // ── 职位名（title 格式：【城市 职位名招聘】-公司-猎聘）─────────────────────
  const jobName = (() => {
    const m = html.match(/<title>(.+?)<\/title>/);
    if (!m) return "";
    const t = unescape(m[1]);
    // 从【城市 职位名招聘】提取职位名
    const inner = t.match(/【\S+\s+(.+?)招聘】/);
    if (inner) return inner[1].trim();
    // 兜底：title 第一段（-号前）
    return t.split("-")[0].replace(/【[^】]*】/g, "").trim();
  })();

  // ── 公司名（meta description 格式：公司名+城市招聘）──────────────────────
  const brandName = (() => {
    // meta description 格式："华大电子北京招聘质量工程师（产品）岗位，薪资..."
    const m = metaDesc.match(/^(.+?)(?:北京|上海|广州|深圳|杭州|成都|武汉|西安|南京|重庆|天津|全国|苏州|厦门|郑州|长沙|济南|青岛|宁波|合肥|福州|无锡|佛山|东莞|沈阳|大连|哈尔滨|长春|呼和浩特|石家庄)招聘/);
    if (m) return m[1].trim();
    // 兜底：HTML class
    const m2 = html.match(/class="company-name"[^>]*>([^<]+)</);
    return m2 ? unescape(m2[1]).trim() : "";
  })();

  // ── 薪资、城市、经验、学历（job-properties span，跳过 class="split" 分隔符）
  const propsBlock = (() => {
    const m = html.match(/class="job-properties"[^>]*>([\s\S]{0,800}?)<\/div>/);
    return m ? m[1] : "";
  })();
  // 只取没有任何 class 的纯文本 span（分隔符 span 有 class="split" 等）
  const propSpans = [...propsBlock.matchAll(/<span(?:\s*class="")?>([\s\S]*?)<\/span>/g)]
    .map(m => unescape(stripTags(m[1])).trim())
    .filter(Boolean);

  const cityName      = propSpans[0] || "";
  const salaryDesc    = (() => {
    const m = metaDesc.match(/薪资([\d\-~kK·薪以上面议]+)/);
    return m ? m[1] : (propSpans.find(s => /[kK]|面议/.test(s)) || "");
  })();
  const jobExperience = propSpans.find(s => /年/.test(s) && !/^\d{4}/.test(s)) || "";
  const jobDegree     = propSpans.find(s => /本科|大专|硕士|博士|高中|学历|统招/.test(s)) || "";

  // ── 行业 + 规模（meta description 中通常有"公司规模XX人"）──────────────────
  const brandScaleName = (() => {
    const m = metaDesc.match(/公司规模(.+?)(?:,|。|$)/);
    return m ? m[1].trim() : "";
  })();
  const brandIndustry = (() => {
    // 从"其他信息"区域提取行业
    const m = html.match(/行业要求[：:]\s*([^<\n，,]{2,30})/);
    return m ? unescape(m[1]).trim() : "";
  })();

  // ── JD 正文（data-selector="job-intro-content"，在"其他信息"dt 前截断）──────
  const jd = (() => {
    const startM = html.match(/data-selector="job-intro-content">/);
    if (!startM) return "";
    const start = startM.index + startM[0].length;
    const chunk = html.slice(start, start + 4000);
    // 在"其他信息"dt、"公司简介"h2 或 </section> 前截断
    const endIdx = Math.min(
      ...[/<dt>其他信息/, /<h2>公司简介/, /<\/section>/, /class="job-other/].map(re => {
        const m = chunk.match(re); return m ? m.index : Infinity;
      })
    );
    let text = endIdx < Infinity ? chunk.slice(0, endIdx) : chunk;
    text = text.replace(/<br\s*\/?>/gi, "\n");
    text = text.replace(/<p[^>]*>/gi, "\n").replace(/<\/p>/gi, "");
    text = text.replace(/<li[^>]*>/gi, "\n• ").replace(/<\/li>/gi, "");
    text = text.replace(/<[^>]+>/g, "");
    return unescape(text).replace(/\n{3,}/g, "\n\n").trim();
  })();

  // ── 部门（其他信息区域）────────────────────────────────────────────────────
  const department = (() => {
    const m = html.match(/所属部门[：:]\s*([^<\n，,]{2,30})/);
    return m ? unescape(m[1]).trim() : "";
  })();

  // ── 公司简介（公司简介 h2 后第一个 p 或 div）──────────────────────────────
  const companyIntro = (() => {
    const m = html.match(/<h2>公司简介<\/h2>[\s\S]{0,200}?<(?:p|div)[^>]*>([\s\S]{20,1200}?)<\/(?:p|div)>/);
    return m ? unescape(stripTags(m[1])).replace(/\s+/g, " ").trim() : "";
  })();

  return {
    ok: true,
    url:          jobUrl,
    jobName,
    brandName,
    salaryDesc,
    cityName,
    jobExperience,
    jobDegree,
    brandIndustry,
    brandScaleName,
    department,
    jd,
    companyIntro,
  };
}

/**
 * 通过 CDP 导航到猎聘职位详情页并提取 JD（解决直接 HTTP 302 重定向问题）
 * @param {string} cdpUrl  Chrome 调试端口，默认 http://127.0.0.1:9223
 * @param {string} jobUrl  猎聘职位页 URL
 * @param {number} timeoutMs  超时毫秒
 */
async function liepinFetchJobDetailCDP(cdpUrl, jobUrl, timeoutMs = 35000) {
  // 改用临时 tab（withTempTab），避免占用/破坏搜索 tab
  // 流程：新 tab → 导航 → 等 transit 跳转完成 → 等 JD 内容 → 提取 → 关 tab

  const EXTRACT_JD = `(()=>{
    const stripTags = s => s.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
    const jdEl = document.querySelector('[data-selector="job-intro-content"]');
    const jd = jdEl ? (jdEl.innerText || '').trim() : '';
    const jobName = (document.querySelector('h1.job-name') || document.querySelector('.job-title'))?.innerText?.trim() || document.title.split('-')[0].trim();
    const brandName = (document.querySelector('.company-name') || document.querySelector('[class*="company-name"]'))?.innerText?.trim() || '';
    const salaryEl = document.querySelector('.job-salary') || document.querySelector('[class*="salary"]');
    const salaryDesc = salaryEl ? salaryEl.innerText.trim() : '';
    const propEls = [...(document.querySelectorAll('.job-properties span') || [])];
    const props = propEls.map(e => e.innerText.trim()).filter(Boolean);
    const cityName = props[0] || '';
    const jobExperience = props.find(s => /年/.test(s) && !/^\\d{4}/.test(s)) || '';
    const jobDegree = props.find(s => /本科|大专|硕士|博士|高中|学历|统招/.test(s)) || '';
    const introEl = document.querySelector('.company-intro') || document.querySelector('[class*="company-intro"]');
    const companyIntro = introEl ? introEl.innerText.replace(/\\s+/g, ' ').trim() : '';
    const deptMatch = document.body.innerText.match(/所属部门[：:]\\s*([^\\n，,]{2,30})/);
    const department = deptMatch ? deptMatch[1].trim() : '';
    const finalUrl = location.href;
    const isTransit = finalUrl.includes('wow.liepin.com') || finalUrl.includes('transit');
    return JSON.stringify({ ok: !!jd && !isTransit, jobName, brandName, salaryDesc, cityName, jobExperience, jobDegree, department, jd, companyIntro, finalUrl, isTransit });
  })()`;

  return withTempTab(cdpUrl, jobUrl, async (rpc) => {
    // 等待：先过 transit（wow.liepin.com），再等 JD 内容出现
    // 总 tick = timeoutMs / 400；前半允许 transit，后半等 JD
    const maxTicks = Math.floor(timeoutMs / 400);
    for (let i = 0; i < maxTicks; i++) {
      await new Promise(r => setTimeout(r, 400));
      const r = await rpc("Runtime.evaluate", {
        expression: `(()=>{
          const ready = document.readyState === 'complete';
          const href = location.href;
          const hasJD = document.querySelectorAll('[data-selector="job-intro-content"]').length > 0;
          const isTransit = href.includes('wow.liepin.com') || href.includes('transit');
          return ready + '|' + hasJD + '|' + isTransit + '|' + href;
        })()`,
        returnByValue: true
      });
      const parts = String(r?.result?.value || "false|false|true|").split("|");
      const ready = parts[0] === "true";
      const hasJD = parts[1] === "true";
      const isTransit = parts[2] === "true";

      if (ready && hasJD) break; // 成功
      if (ready && !isTransit && i > 20) break; // 页面加载完但无 JD（可能职位已关闭）
    }

    const extracted = await rpc("Runtime.evaluate", { expression: EXTRACT_JD, returnByValue: true });
    let data;
    try { data = JSON.parse(extracted?.result?.value || "{}"); } catch { data = { ok: false }; }

    // 若卡在 transit：说明未登录
    if (data.isTransit || String(data.finalUrl || "").includes("wow.liepin.com")) {
      return {
        ok: false,
        reason: "not-logged-in",
        message: "职位详情需要登录猎聘。请在调试 Chrome（端口 9223）中先登录猎聘账号。",
        finalUrl: data.finalUrl || "",
        url: jobUrl
      };
    }
    return { ...data, url: jobUrl };
  }, { timeoutMs });
}

// ── end Liepin helpers ────────────────────────────────────────────────────────

// ── 51job（前程无忧）helpers ─────────────────────────────────────────────────
//
// we.51job.com 是 Vue SPA。诊断发现职位数据已完全渲染到 DOM，
// 且每个卡片的 sensorsdata 属性含完整结构化 JSON。
// 策略：导航后等待 .joblist-item 出现，直接 DOM 提取（无需 XHR 拦截器）。

const JOB51_DOM_EXTRACT = `(()=>{
  const items = document.querySelectorAll('.joblist-item');
  if (!items.length) return JSON.stringify({ ok: false, reason: 'no-items' });
  const jobs = [...items].map(el => {
    let sd = {};
    try { sd = JSON.parse(el.querySelector('[sensorsdata]')?.getAttribute('sensorsdata') || '{}'); } catch {}
    const get = sel => el.querySelector(sel)?.textContent?.trim() || '';
    const dcEls = [...el.querySelectorAll('.dc')];
    const welfare = [...(el.querySelectorAll('.tag-list span,[class*="welfare"] span') || [])].map(t => t.textContent?.trim()).filter(Boolean);
    return {
      jobId:    sd.jobId    || '',
      jobName:  get('.jname') || sd.jobTitle || '',
      salary:   get('.sal')   || sd.jobSalary || '',
      company:  get('.cname') || '',
      area:     sd.jobArea    || '',
      exp:      sd.jobYear    || '',
      degree:   sd.jobDegree  || '',
      industry: dcEls[0]?.textContent?.trim() || '',
      coType:   dcEls[1]?.textContent?.trim() || '',
      coSize:   dcEls[2]?.textContent?.trim() || '',
      url:      el.querySelector('a[href*="51job.com"]')?.href || '',
      welfare
    };
  });
  const pgBtns = [...document.querySelectorAll('.el-pager li')].map(b => Number(b.textContent?.trim())).filter(n => n > 0);
  const totalPages  = pgBtns.length ? Math.max(...pgBtns) : 1;
  const currentPage = Number(document.querySelector('.el-pager li.active')?.textContent?.trim()) || 1;
  return JSON.stringify({ ok: true, jobs, totalPages, currentPage, currentUrl: location.href });
})()`;

async function job51GetPageState(wsUrl, pageUrl, timeoutMs) {
  timeoutMs = timeoutMs || 25000;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error("job51GetPageState timeout")); }
    }, timeoutMs);

    const rpc = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      try { ws.send(JSON.stringify({ id, method, params: params || {} })); }
      catch (e) { pending.delete(id); rej(e); }
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(result);
    };

    ws.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message || JSON.stringify(m.error)));
        else res(m.result);
      }
    });

    ws.addEventListener("error", () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error("WebSocket error in job51GetPageState")); }
    });

    ws.addEventListener("open", async () => {
      try {
        await rpc("Page.enable", {});
        await rpc("Runtime.enable", {});

        if (pageUrl) {
          await rpc("Page.navigate", { url: pageUrl });
        }

        // 轮询直到 .joblist-item 出现且 readyState=complete（max ~22s）
        for (let i = 0; i < 55; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const r = await rpc("Runtime.evaluate", {
            expression: "(document.readyState === 'complete' ? '1' : '0') + '|' + document.querySelectorAll('.joblist-item').length",
            returnByValue: true
          });
          const [ready, cnt] = String(r?.result?.value || "0|0").split("|");
          if (ready === "1" && Number(cnt) > 0) break;
        }

        // DOM 提取
        const extracted = await rpc("Runtime.evaluate", {
          expression: JOB51_DOM_EXTRACT,
          returnByValue: true
        });

        const data = JSON.parse(extracted?.result?.value || "{}");
        finish(data);
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(err); }
      }
    });
  });
}

async function findFront51jobPageTarget(cdpUrl) {
  const response = await fetch(`${cdpUrl}/json/list`);
  if (!response.ok) throw new Error(`CDP list request failed: ${response.status}`);
  const targets = await response.json();
  const pages = (Array.isArray(targets) ? targets : []).filter((t) => t?.type === "page");
  const weSearch = pages.find((t) => String(t.url || "").includes("we.51job.com/pc/search"));
  if (weSearch?.webSocketDebuggerUrl) return weSearch;
  const any51 = pages.find((t) => String(t.url || "").includes("51job.com"));
  if (any51?.webSocketDebuggerUrl) return any51;
  return null;
}

// 页内翻页：点击目标页码按钮（或 btn-next），等待 Vue 重渲染，再 DOM 提取
async function job51NextPage(wsUrl, targetPage, timeoutMs) {
  timeoutMs = timeoutMs || 25000;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error("job51NextPage timeout")); }
    }, timeoutMs);

    const rpc = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      try { ws.send(JSON.stringify({ id, method, params: params || {} })); }
      catch (e) { pending.delete(id); rej(e); }
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(result);
    };

    ws.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message || JSON.stringify(m.error)));
        else res(m.result);
      }
    });

    ws.addEventListener("error", () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error("WebSocket error in job51NextPage")); }
    });

    ws.addEventListener("open", async () => {
      try {
        await rpc("Runtime.enable", {});

        // 记录当前第1条 jobId（用于检测数据是否更新）
        const beforeR = await rpc("Runtime.evaluate", {
          expression: "document.querySelector('[sensorsdata]')?.getAttribute('sensorsdata')",
          returnByValue: true
        });
        let beforeId = "";
        try { beforeId = JSON.parse(beforeR?.result?.value || "{}").jobId || ""; } catch {}

        // 尝试点击目标页码按钮；找不到时退化为 btn-next
        const clickExpr = `(()=>{
          const target = ${targetPage};
          const btns = [...document.querySelectorAll('.el-pager li')];
          const btn = btns.find(b => Number(b.textContent?.trim()) === target);
          if (btn && !btn.classList.contains('active')) { btn.click(); return 'btn-' + target; }
          const next = document.querySelector('.btn-next');
          if (next && !next.disabled) { next.click(); return 'btn-next'; }
          return 'no-btn';
        })()`;
        const clickR = await rpc("Runtime.evaluate", { expression: clickExpr, returnByValue: true });
        const clickResult = clickR?.result?.value || "";

        if (clickResult === "no-btn") {
          finish({ ok: false, reason: "no-clickable-button", targetPage });
          return;
        }

        // 等待 activePage 和数据更新（max ~20s）
        for (let i = 0; i < 50; i++) {
          await new Promise((r) => setTimeout(r, 400));
          const r = await rpc("Runtime.evaluate", {
            expression: `(()=>{
              const active = document.querySelector('.el-pager li.active')?.textContent?.trim();
              const firstId = (()=>{ try { return JSON.parse(document.querySelector('[sensorsdata]')?.getAttribute('sensorsdata')||'{}').jobId||''; } catch { return ''; } })();
              return active + '|' + firstId;
            })()`,
            returnByValue: true
          });
          const [activePage, firstId] = String(r?.result?.value || "|").split("|");
          if (Number(activePage) === targetPage && firstId !== beforeId && firstId) break;
        }

        // DOM 提取
        const extracted = await rpc("Runtime.evaluate", { expression: JOB51_DOM_EXTRACT, returnByValue: true });
        const data = JSON.parse(extracted?.result?.value || "{}");
        finish({ ...data, clickResult });
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(err); }
      }
    });
  });
}

// ── end 51job helpers ────────────────────────────────────────────────────────

// ── 通用 CDP 临时 tab 辅助 ────────────────────────────────────────────────────

/**
 * 打开一个临时 Chrome tab，在其中执行 fn(rpc)，完成后关闭 tab。
 * rpc(method, params) → Promise<result>（自动 Network.enable + Runtime.enable）
 */
async function withTempTab(cdpUrl, url, fn, { timeoutMs = 30000 } = {}) {
  // 用 browser-level Target.createTarget 打开新 tab
  const browserWsUrl = await fetchCdpWebSocketUrl(cdpUrl);
  const createResult = await new Promise((resolve, reject) => {
    const ws = new WebSocket(browserWsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error("createTarget timeout")); }, 8000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url } })));
    ws.addEventListener("message", ({ data }) => {
      const m = JSON.parse(data);
      if (m.id === 1) { clearTimeout(timer); ws.close(); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
    });
    ws.addEventListener("error", e => { clearTimeout(timer); reject(new Error(String(e))); });
  });
  const targetId = createResult?.targetId;
  if (!targetId) throw new Error("createTarget: no targetId");

  // 等最多 3 秒让 tab 出现在 /json/list
  let tabWsUrl = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 200));
    const pages = await fetch(`${cdpUrl}/json/list`).then(r => r.json()).catch(() => []);
    const t = pages.find(p => p.id === targetId);
    if (t?.webSocketDebuggerUrl) { tabWsUrl = t.webSocketDebuggerUrl; break; }
  }
  if (!tabWsUrl) throw new Error("withTempTab: tab wsUrl not found");

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const ws = new WebSocket(tabWsUrl);
      const pending = new Map();
      let nextId = 1;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error("withTempTab fn timeout")); }
      }, timeoutMs);

      const rpc = (method, params = {}) => new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        try { ws.send(JSON.stringify({ id, method, params })); }
        catch (e) { pending.delete(id); rej(e); }
      });

      ws.addEventListener("message", (ev) => {
        let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.id && pending.has(m.id)) {
          const { res, rej } = pending.get(m.id); pending.delete(m.id);
          if (m.error) rej(new Error(m.error.message || JSON.stringify(m.error))); else res(m.result);
        }
      });
      ws.addEventListener("error", () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error("withTempTab WebSocket error")); }
      });
      ws.addEventListener("open", async () => {
        try {
          await rpc("Page.enable", {});
          await rpc("Runtime.enable", {});
          const r = await fn(rpc);
          if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} resolve(r); }
        } catch (err) {
          if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(err); }
        }
      });
    });
  } finally {
    // 关闭 tab（忽略错误）
    await callCdpMethod(cdpUrl, "Target.closeTarget", { targetId }).catch(() => {});
  }
  return result;
}

// ── 前程无忧（51job）JD 详情 ─────────────────────────────────────────────────

/**
 * 通过 CDP 打开新 tab 导航到 51job JD 页（jobs.51job.com/{city}/{jobId}.html），
 * 等待 antidom.js 挑战解决后提取 JD。
 * 注意：URL 必须是真实职位详情页，不能是公司页（/all/coXXX.html）。
 */
async function fetch51jobDetailCDP(cdpUrl, jobUrl, timeoutMs = 35000) {
  // jobs.51job.com 真实 DOM 结构（已通过 CDP 探测确认）：
  //   h1               → 职位名称
  //   strong           → 薪资
  //   p.ltype          → 城市 | 经验 | 学历
  //   a.com_name       → 公司名（链接到公司页）
  //   .bmsg            → JD 正文
  const EXTRACT_51JOB_JD = `(()=>{
    const title   = document.querySelector('h1')?.innerText?.trim() || '';
    const salary  = document.querySelector('strong')?.innerText?.trim() || '';
    const ltype   = document.querySelector('p.ltype')?.innerText?.trim() || '';
    const company = (document.querySelector('a.com_name') || document.querySelector('[class*="com_name"] a') || document.querySelector('a[href*="/all/co"]'))?.innerText?.trim() || '';
    const jdEl    = document.querySelector('.bmsg') || document.querySelector('#job-content') || document.querySelector('.job-describe');
    const jd      = jdEl ? (jdEl.innerText || jdEl.textContent || '').replace(/\\s+/g,' ').trim() : '';
    const isChallenge = !jd && document.body?.innerText?.trim()?.length < 100;
    const isTransit   = location.href.includes('antidom') || location.href.includes('transit') || location.href.includes('/all/co');
    const ok = Boolean(jd) && !isChallenge && !isTransit;
    return JSON.stringify({ ok, jobName: title, brandName: company, salaryDesc: salary, cityName: ltype, jd, url: location.href });
  })()`;

  return withTempTab(cdpUrl, jobUrl, async (rpc) => {
    // antidom.js 挑战通常 2-5s 完成；等待 .bmsg 出现
    for (let i = 0; i < Math.floor(timeoutMs / 400); i++) {
      await new Promise(r => setTimeout(r, 400));
      const r = await rpc("Runtime.evaluate", {
        expression: `(()=>{
          const ready   = document.readyState === 'complete';
          const hasJD   = !!(document.querySelector('.bmsg') || document.querySelector('#job-content') || document.querySelector('.job-describe'));
          const hasBody = document.body?.innerText?.trim()?.length > 200;
          return ready + '|' + hasJD + '|' + hasBody;
        })()`,
        returnByValue: true
      });
      const parts = String(r?.result?.value || "false|false|false").split("|");
      const [ready, hasJD, hasBody] = [parts[0] === "true", parts[1] === "true", parts[2] === "true"];
      if (ready && (hasJD || (hasBody && i > 5))) break;
    }

    const extracted = await rpc("Runtime.evaluate", { expression: EXTRACT_51JOB_JD, returnByValue: true });
    let data;
    try { data = JSON.parse(extracted?.result?.value || "{}"); } catch { data = { ok: false }; }
    return { ...data, url: jobUrl };
  }, { timeoutMs });
}

/**
 * 在已打开的 51job 搜索页中，找到指定 jobId 的卡片，点击标题（.jname），
 * 等待新 tab 打开并加载职位详情页，提取 JD 后关闭新 tab。
 *
 * 原理：51job SPA 点击职位标题会 window.open() 到 jobs.51job.com/{city}/{jobId}.html。
 * @param {string} cdpUrl  CDP 地址
 * @param {string} jobId   职位 ID（来自搜索结果 sensorsdata.jobId）
 * @param {number} timeoutMs
 */
async function fetch51jobDetailFromSearch(cdpUrl, jobId, timeoutMs = 35000) {
  const jobIdStr = String(jobId).trim();
  if (!jobIdStr) return { ok: false, reason: "missing-jobId", message: "jobId 不能为空" };

  // 1. 找到 51job 搜索 tab
  const searchTarget = await findFront51jobPageTarget(cdpUrl);
  if (!searchTarget?.webSocketDebuggerUrl) {
    return { ok: false, reason: "no-51job-tab", message: "未找到打开的前程无忧搜索页，请先在 Chrome 中打开前程无忧搜索结果" };
  }

  // 2. 记录当前 tab ID 列表，用于检测新 tab
  const getPageIds = async () => {
    try {
      const pages = await fetch(`${cdpUrl}/json/list`).then(r => r.json()).catch(() => []);
      return new Set(pages.filter(p => p.type === "page").map(p => p.id));
    } catch { return new Set(); }
  };
  const beforeIds = await getPageIds();

  // 3. 在搜索页点击对应 jobId 的 .jname
  const clickResult = await new Promise((resolve, reject) => {
    const ws = new WebSocket(searchTarget.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 1;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error("click timeout")); }
    }, 10000);
    const rpc = (method, params) => new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message)); else res(m.result);
      }
    });
    ws.addEventListener("error", () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error("WebSocket error")); }
    });
    ws.addEventListener("open", async () => {
      try {
        await rpc("Runtime.enable", {});
        const r = await rpc("Runtime.evaluate", {
          expression: `(()=>{
            const jid = ${JSON.stringify(jobIdStr)};
            for (const card of document.querySelectorAll('.joblist-item')) {
              let sd = {};
              try { sd = JSON.parse(card.querySelector('[sensorsdata]')?.getAttribute('sensorsdata') || '{}'); } catch {}
              if (String(sd.jobId) === jid) {
                const jname = card.querySelector('.jname');
                if (jname) { jname.click(); return 'clicked'; }
                return 'no-jname';
              }
            }
            return 'not-found';
          })()`,
          returnByValue: true
        });
        if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} resolve(r?.result?.value || "error"); }
      } catch (err) {
        if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(err); }
      }
    });
  });

  if (clickResult !== "clicked") {
    return { ok: false, reason: "job-not-on-page", jobId: jobIdStr, clickResult,
      message: `jobId ${jobIdStr} 不在当前搜索页（${clickResult}），请确保搜索结果页仍显示该职位` };
  }

  // 4. 轮询等待新 tab 出现（最多 8s）
  let newTabId = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 400));
    const afterIds = await getPageIds();
    const diff = [...afterIds].filter(id => !beforeIds.has(id));
    if (diff.length > 0) { newTabId = diff[0]; break; }
  }
  if (!newTabId) {
    return { ok: false, reason: "no-new-tab", jobId: jobIdStr, message: "点击后未检测到新 tab 打开" };
  }

  // 5. 找到新 tab 的 wsDebuggerUrl
  let newTabWsUrl = null;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 400));
    const pages = await fetch(`${cdpUrl}/json/list`).then(r => r.json()).catch(() => []);
    const tab = pages.find(p => p.id === newTabId);
    if (tab?.webSocketDebuggerUrl && tab.url && tab.url !== "about:blank") {
      newTabWsUrl = tab.webSocketDebuggerUrl;
      break;
    }
  }
  if (!newTabWsUrl) {
    // close orphan tab
    await fetch(`${cdpUrl}/json/close/${newTabId}`).catch(() => {});
    return { ok: false, reason: "new-tab-no-url", jobId: jobIdStr, message: "新 tab 未导航到目标 URL" };
  }

  // 6. 在新 tab 中等待 .bmsg 加载，提取 JD
  const EXTRACT_51JOB_JD = `(()=>{
    const title   = document.querySelector('h1')?.innerText?.trim() || '';
    const salary  = document.querySelector('strong')?.innerText?.trim() || '';
    const ltype   = document.querySelector('p.ltype')?.innerText?.trim() || '';
    const company = (document.querySelector('a.com_name') || document.querySelector('a[href*="/all/co"]'))?.innerText?.trim() || '';
    const jdEl    = document.querySelector('.bmsg') || document.querySelector('#job-content') || document.querySelector('.job-describe');
    const jd      = jdEl ? (jdEl.innerText || jdEl.textContent || '').replace(/\\s+/g,' ').trim() : '';
    const ok = Boolean(jd) && document.body?.innerText?.trim()?.length > 100;
    return JSON.stringify({ ok, jobName: title, brandName: company, salaryDesc: salary, cityName: ltype, jd, url: location.href });
  })()`;

  let extractResult = { ok: false };
  try {
    extractResult = await new Promise((resolve, reject) => {
      const ws = new WebSocket(newTabWsUrl);
      const pending = new Map();
      let nextId = 1;
      let settled = false;
      const remaining = timeoutMs - 12000; // 已用约 12s 在等待 tab
      const timer = setTimeout(() => {
        if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error("extract timeout")); }
      }, Math.max(remaining, 8000));
      const rpc = (method, params) => new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      });
      ws.addEventListener("message", (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
          const { res, rej } = pending.get(m.id); pending.delete(m.id);
          if (m.error) rej(new Error(m.error.message)); else res(m.result);
        }
      });
      ws.addEventListener("error", () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error("WebSocket error on new tab")); }
      });
      ws.addEventListener("open", async () => {
        try {
          await rpc("Runtime.enable", {});
          // 等待 .bmsg（antidom 通常 2-5s）
          const ticks = Math.floor(Math.max(remaining, 8000) / 400);
          for (let i = 0; i < ticks; i++) {
            await new Promise(r => setTimeout(r, 400));
            const r = await rpc("Runtime.evaluate", {
              expression: `(()=>{
                const ready = document.readyState === 'complete';
                const hasJD = !!(document.querySelector('.bmsg') || document.querySelector('#job-content'));
                const hasBody = document.body?.innerText?.trim()?.length > 200;
                return ready + '|' + hasJD + '|' + hasBody;
              })()`,
              returnByValue: true
            });
            const [ready, hasJD, hasBody] = String(r?.result?.value || "").split("|");
            if (ready === "true" && (hasJD === "true" || (hasBody === "true" && i > 5))) break;
          }
          const extracted = await rpc("Runtime.evaluate", { expression: EXTRACT_51JOB_JD, returnByValue: true });
          let data;
          try { data = JSON.parse(extracted?.result?.value || "{}"); } catch { data = { ok: false }; }
          if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} resolve(data); }
        } catch (err) {
          if (!settled) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(err); }
        }
      });
    });
  } catch (e) {
    extractResult = { ok: false, reason: "extract-error", message: String(e) };
  }

  // 7. 关闭新 tab
  await fetch(`${cdpUrl}/json/close/${newTabId}`).catch(() => {});

  return { ...extractResult, jobId: jobIdStr, source: "click-new-tab" };
}

async function findFrontBossPageTarget(cdpUrl, frontChromeUrl = "") {
  const response = await fetch(`${cdpUrl}/json/list`);
  if (!response.ok) {
    throw new Error(`CDP list request failed: ${response.status}`);
  }
  const targets = await response.json();
  const pages = (Array.isArray(targets) ? targets : []).filter((item) => item?.type === "page");

  const exact = pages.find((item) => String(item.url || "") === String(frontChromeUrl || ""));
  if (exact?.webSocketDebuggerUrl) return exact;

  const bossPage = pages.find((item) => String(item.url || "").includes("zhipin.com/web/geek/jobs"));
  if (bossPage?.webSocketDebuggerUrl) return bossPage;

  const anyBoss = pages.find((item) => String(item.url || "").includes("zhipin.com"));
  if (anyBoss?.webSocketDebuggerUrl) return anyBoss;

  return null;
}

async function resolveRequestCookie(body) {
  const directCookie = resolveCookie(body);
  if (directCookie) {
    return {
      cookie: directCookie,
      source: body?.cookie ? "request-body" : "env-default",
      cdpUrl: "",
      cookieCount: null
    };
  }

  const requestedSource = String(body?.cookieSource || "").trim().toLowerCase();
  const useCdpCookie = body?.useCdpCookie === true || requestedSource === "cdp";
  if (!useCdpCookie) {
    return {
      cookie: "",
      source: "none",
      cdpUrl: "",
      cookieCount: null
    };
  }

  const cdpUrl = String(body?.cdpUrl || DEFAULT_CDP_URL).trim();
  const cdpCookie = await extractBossCookiesFromCdp(cdpUrl);
  return {
    cookie: cdpCookie.cookieHeader,
    source: "cdp",
    cdpUrl,
    cookieCount: cdpCookie.cookieCount
  };
}

async function fetchDetailViaBrowserContext({ cdpUrl, frontChromeUrl, detailUrl, referer }) {
  const target = await findFrontBossPageTarget(cdpUrl, frontChromeUrl);
  if (!target?.webSocketDebuggerUrl) {
    return {
      ok: false,
      reason: "no-boss-page-target"
    };
  }

  const expression = `
    (async () => {
      try {
        const res = await fetch(${JSON.stringify(detailUrl)}, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Referer': ${JSON.stringify(referer)}
          }
        });
        const text = await res.text();
        return JSON.stringify({
          ok: true,
          status: res.status,
          finalUrl: res.url,
          text
        });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: String(error)
        });
      }
    })()
  `;

  const result = await callTargetCdpMethod(target.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  const raw = String(result?.result?.value || "");
  if (!raw) {
    return {
      ok: false,
      reason: "empty-browser-fetch-result",
      targetUrl: target.url || ""
    };
  }

  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    targetUrl: target.url || "",
    targetTitle: target.title || ""
  };
}

async function evaluateOnBossSearchPage(cdpUrl, frontChromeUrl, expression, { awaitPromise = false } = {}) {
  const target = await findFrontBossPageTarget(cdpUrl, frontChromeUrl);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("未找到可用的 Boss 搜索结果页标签");
  }
  const result = await callTargetCdpMethod(target.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true
  });
  return {
    targetUrl: target.url || "",
    targetTitle: target.title || "",
    value: result?.result?.value
  };
}

async function readVisibleJobsFromSearchPage({ cdpUrl, frontChromeUrl, limit = 5, enrichDescription = false, targetEncryptId = "", targetSecurityId = "" }) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 5));
  const targetId = String(targetEncryptId || "").trim();
  const targetSid = String(targetSecurityId || "").trim();
  const expression = `(${async function browserTask(maxItems, shouldEnrich, wantedId, wantedSid) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const links = Array.from(document.querySelectorAll('a[href*="/job_detail/"]'))
      .filter((a) => (a.href || "").includes("/job_detail/"))
      .slice(0, maxItems);

    const parseHref = (href) => {
      try {
        const url = new URL(href, location.origin);
        return {
          href: url.toString(),
          encryptId: (url.pathname.match(/job_detail\/([^/.]+)\.html/) || [])[1] || "",
          securityId: url.searchParams.get("securityId") || ""
        };
      } catch {
        return {
          href: String(href || ""),
          encryptId: "",
          securityId: ""
        };
      }
    };

    const clickAndRead = async (link) => {
      const rect = link.getBoundingClientRect();
      const fire = (type) => link.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + 10,
        clientY: rect.top + 10
      }));
      fire("mouseover");
      fire("mouseenter");
      fire("mousemove");
      await sleep(400);
      fire("mousedown");
      fire("mouseup");
      fire("click");

      let tries = 0;
      while (tries < 14) {
        await sleep(350);
        const info = window._jobInfo || {};
        if (info && info.encryptId) {
          return info;
        }
        tries += 1;
      }
      return window._jobInfo || {};
    };

    const rawItems = links.map((link, index) => {
      const parsed = parseHref(link.href || "");
      const box = link.closest("li") || link.closest("div");
      return {
        index,
        title: (link.innerText || "").trim(),
        href: parsed.href,
        encryptId: parsed.encryptId,
        securityId: parsed.securityId,
        cardText: (box?.innerText || "").trim().slice(0, 500)
      };
    });

    const chosen = wantedId
      ? rawItems.filter((item) => item.encryptId === wantedId || (wantedSid && item.securityId === wantedSid))
      : rawItems;

    const results = [];
    for (const item of chosen) {
      const link = links[item.index];
      if (!link) continue;
      if (!shouldEnrich) {
        results.push(item);
        continue;
      }
      const info = await clickAndRead(link);
      results.push({
        ...item,
        activeJobName: info.jobName || "",
        activeEncryptId: info.encryptId || "",
        activeSecurityId: info.securityId || "",
        salaryDesc: info.salaryDesc || "",
        locationName: info.locationName || "",
        experienceName: info.experienceName || "",
        degreeName: info.degreeName || "",
        showSkills: Array.isArray(info.showSkills) ? info.showSkills : [],
        jobStatusDesc: info.jobStatusDesc || "",
        postDescription: info.postDescription || ""
      });
      if (wantedId) break;
    }

    return JSON.stringify({
      ok: true,
      pageTitle: document.title,
      pageUrl: location.href,
      totalVisible: rawItems.length,
      matchedCount: results.length,
      jobs: results
    });
  }})(${JSON.stringify(safeLimit)}, ${JSON.stringify(enrichDescription)}, ${JSON.stringify(targetId)}, ${JSON.stringify(targetSid)})`;

  const result = await evaluateOnBossSearchPage(cdpUrl, frontChromeUrl, expression, { awaitPromise: true });
  return {
    targetUrl: result.targetUrl,
    targetTitle: result.targetTitle,
    ...(JSON.parse(String(result.value || "{}")))
  };
}

function pickNestedValue(obj, candidates) {
  for (const key of candidates) {
    if (obj && typeof obj === "object" && key in obj && obj[key]) {
      return obj[key];
    }
  }
  return "";
}

function findDescriptionInJsonPayload(input, depth = 0) {
  if (!input || depth > 6) return "";
  if (typeof input === "string") return "";
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findDescriptionInJsonPayload(item, depth + 1);
      if (found) return found;
    }
    return "";
  }

  const direct = pickNestedValue(input, [
    "postDescription",
    "jobDescription",
    "description",
    "postDesc"
  ]);
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  for (const value of Object.values(input)) {
    const found = findDescriptionInJsonPayload(value, depth + 1);
    if (found) return found;
  }
  return "";
}

function extractTitleFromJsonPayload(input) {
  if (!input || typeof input !== "object") return "";
  const direct = pickNestedValue(input, [
    "jobName",
    "positionName",
    "postName",
    "title"
  ]);
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  return "";
}

async function captureDetailViaSearchPageApi({ cdpUrl, frontChromeUrl, targetEncryptId = "", targetSecurityId = "" }) {
  const expression = `(${async function browserTask(wantedId, wantedSid) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const links = Array.from(document.querySelectorAll('a[href*="/job_detail/"]'))
      .filter((a) => (a.href || "").includes("/job_detail/"));

    const parseHref = (href) => {
      try {
        const url = new URL(href, location.origin);
        return {
          href: url.toString(),
          encryptId: (url.pathname.match(/job_detail\/([^/.]+)\.html/) || [])[1] || "",
          securityId: url.searchParams.get("securityId") || ""
        };
      } catch {
        return {
          href: String(href || ""),
          encryptId: "",
          securityId: ""
        };
      }
    };

    const targetLink = links.find((link) => {
      const parsed = parseHref(link.href || "");
      if (wantedId && parsed.encryptId === wantedId) return true;
      if (wantedSid && parsed.securityId === wantedSid) return true;
      return false;
    }) || links[0];

    if (!targetLink) {
      return JSON.stringify({
        ok: false,
        reason: "no-job-link-on-search-page",
        pageUrl: location.href,
        pageTitle: document.title
      });
    }

    const parsedTarget = parseHref(targetLink.href || "");
    const captured = {
      url: "",
      method: "",
      requestHeaders: {},
      responseHeaders: {},
      status: null,
      responseText: "",
      finalUrl: "",
      via: ""
    };

    const restore = [];
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]?.url || args[0] || "");
      const options = args[1] || {};
      const res = await originalFetch(...args);
      if (url.includes("/wapi/zpgeek/job/detail.json")) {
        captured.url = url;
        captured.method = String(options.method || "GET");
        captured.requestHeaders = options.headers || {};
        captured.status = res.status;
        captured.finalUrl = res.url || url;
        captured.via = "fetch";
        try {
          captured.responseText = await res.clone().text();
        } catch { }
        try {
          captured.responseHeaders = Object.fromEntries(res.headers.entries());
        } catch { }
      }
      return res;
    };
    restore.push(() => {
      window.fetch = originalFetch;
    });

    const XHR = window.XMLHttpRequest;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    const originalSetRequestHeader = XHR.prototype.setRequestHeader;
    XHR.prototype.open = function (method, url, ...rest) {
      this.__bossUrl = String(url || "");
      this.__bossMethod = String(method || "GET");
      this.__bossHeaders = {};
      return originalOpen.call(this, method, url, ...rest);
    };
    XHR.prototype.setRequestHeader = function (name, value) {
      try {
        this.__bossHeaders[String(name || "")] = String(value || "");
      } catch { }
      return originalSetRequestHeader.call(this, name, value);
    };
    XHR.prototype.send = function (...args) {
      this.addEventListener("loadend", function () {
        if (String(this.__bossUrl || "").includes("/wapi/zpgeek/job/detail.json")) {
          captured.url = String(this.__bossUrl || "");
          captured.method = String(this.__bossMethod || "GET");
          captured.requestHeaders = this.__bossHeaders || {};
          captured.status = Number(this.status || 0);
          captured.finalUrl = String(this.responseURL || this.__bossUrl || "");
          captured.responseText = typeof this.responseText === "string" ? this.responseText : "";
          captured.via = "xhr";
          const rawHeaders = String(this.getAllResponseHeaders() || "").trim().split(/\\r?\\n/);
          const mapped = {};
          for (const line of rawHeaders) {
            const idx = line.indexOf(":");
            if (idx > 0) {
              mapped[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
          }
          captured.responseHeaders = mapped;
        }
      }, { once: false });
      return originalSend.apply(this, args);
    };
    restore.push(() => {
      XHR.prototype.open = originalOpen;
      XHR.prototype.send = originalSend;
      XHR.prototype.setRequestHeader = originalSetRequestHeader;
    });

    const rect = targetLink.getBoundingClientRect();
    const fire = (type) => targetLink.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + 12,
      clientY: rect.top + 12
    }));

    fire("mouseover");
    fire("mouseenter");
    fire("mousemove");
    await sleep(250);
    fire("mousedown");
    fire("mouseup");
    fire("click");

    let tries = 0;
    while (tries < 24) {
      await sleep(250);
      const info = window._jobInfo || {};
      if (captured.responseText || info.postDescription || (wantedId && info.encryptId === wantedId)) {
        break;
      }
      tries += 1;
    }

    for (const fn of restore.reverse()) {
      try { fn(); } catch { }
    }

    const info = window._jobInfo || {};
    return JSON.stringify({
      ok: true,
      pageUrl: location.href,
      pageTitle: document.title,
      selectedHref: parsedTarget.href,
      selectedEncryptId: parsedTarget.encryptId,
      selectedSecurityId: parsedTarget.securityId,
      activeJobInfo: {
        jobName: info.jobName || "",
        encryptId: info.encryptId || "",
        securityId: info.securityId || "",
        postDescription: info.postDescription || "",
        salaryDesc: info.salaryDesc || "",
        locationName: info.locationName || "",
        experienceName: info.experienceName || "",
        degreeName: info.degreeName || ""
      },
      intercepted: captured
    });
  }})(${JSON.stringify(String(targetEncryptId || "").trim())}, ${JSON.stringify(String(targetSecurityId || "").trim())})`;

  const result = await evaluateOnBossSearchPage(cdpUrl, frontChromeUrl, expression, { awaitPromise: true });
  return {
    targetUrl: result.targetUrl,
    targetTitle: result.targetTitle,
    ...(JSON.parse(String(result.value || "{}")))
  };
}

async function verifySession(cookie, referer) {
  const ts = Date.now();
  return callWithRetry(() => callBossJson(
    `https://www.zhipin.com/wapi/zpuser/wap/getUserInfo.json?_=${ts}`,
    {
      method: "GET",
      headers: buildHeaders({ cookie, referer, xRequestedWith: true })
    }
  ));
}

async function setToken(cookie, referer) {
  return callWithRetry(() => callBossJson(
    "https://www.zhipin.com/wapi/zppassport/set/zpToken",
    {
      method: "POST",
      headers: buildHeaders({ cookie, referer, xRequestedWith: false })
    }
  ));
}

async function searchJobs({ cookie, query, city, page, pageSize, referer }) {
  const params = new URLSearchParams({
    query,
    city,
    page: String(page),
    pageSize: String(pageSize)
  });
  return callWithRetry(() => callBossJson(
    `https://www.zhipin.com/wapi/zpgeek/search/joblist.json?${params.toString()}`,
    {
      method: "GET",
      headers: buildHeaders({ cookie, referer, xRequestedWith: true })
    }
  ));
}

function normalizeDetailUrl({ url, encryptJobId, securityId }) {
  const fromUrl = String(url || "").trim();
  if (fromUrl) return fromUrl;
  const id = String(encryptJobId || "").trim();
  if (!id) return "";
  const sid = String(securityId || "").trim();
  const base = `https://www.zhipin.com/job_detail/${id}.html`;
  if (!sid) return base;
  return `${base}?securityId=${encodeURIComponent(sid)}`;
}

function extractJobDescriptionFromHtml(htmlText) {
  const titleMatch = String(htmlText || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = decodeHtmlEntities(titleMatch?.[1] || "").replace(/\s+/g, " ").trim();

  const noScript = String(htmlText || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const plain = decodeHtmlEntities(noScript.replace(/<[^>]+>/g, "\n"))
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();

  const start = plain.indexOf("职位描述");
  if (start < 0) {
    return {
      pageTitle,
      description: "",
      plainTextPreview: plain.slice(0, 2000)
    };
  }
  const cutMarks = ["BOSS 安全提示", "公司介绍", "工商信息", "工作地址", "更多职位", "看过该职位的人还看了"];
  let end = plain.length;
  for (const mark of cutMarks) {
    const idx = plain.indexOf(mark, start + 4);
    if (idx > -1 && idx < end) end = idx;
  }

  return {
    pageTitle,
    description: plain.slice(start, end).trim(),
    plainTextPreview: plain.slice(0, 2000)
  };
}

async function verifyAndPrepare(cookie, referer) {
  const verify = await verifySession(cookie, referer);
  if (verify?.data?.code !== 0) {
    return {
      ok: false,
      stage: "verify",
      verify,
      token: null
    };
  }
  const token = await setToken(cookie, referer);
  return {
    ok: true,
    stage: "ready",
    verify,
    token
  };
}

function buildDetailReferers({ referer, query, city, securityId, frontChromeUrl }) {
  const listUrl = `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(String(query || "SQE"))}&city=${encodeURIComponent(String(city || "101280800"))}`;
  const securitySearchUrl = securityId
    ? `${listUrl}&securityId=${encodeURIComponent(securityId)}`
    : "";

  return unique([
    frontChromeUrl,
    referer,
    securitySearchUrl,
    listUrl,
    "https://www.zhipin.com/"
  ]);
}

const server = http.createServer(async (req, res) => {
  const ip = getClientIp(req);
  if (!allowRate(ip)) {
    return json(res, 429, { ok: false, message: "请求太快，请稍后再试" });
  }

  if (!checkAuth(req)) {
    return json(res, 401, { ok: false, message: "鉴权失败，请检查 x-api-key 或 Bearer Token" });
  }

  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, {
      ok: true,
      service: "boss-api-server",
      port: PORT,
      hasDefaultCookie: Boolean(DEFAULT_COOKIE),
      conservativeDefaults: {
        rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
        rateLimitMaxReq: RATE_LIMIT_MAX_REQ,
        searchAllMaxPagesHard: SEARCH_ALL_MAX_PAGES_HARD,
        searchAllDefaultPagePauseMs: SEARCH_ALL_DEFAULT_PAGE_PAUSE_MS,
        searchAllFailureRestartDelayMs: SEARCH_ALL_FAILURE_RESTART_DELAY_MS,
        searchAllMaxRestarts: SEARCH_ALL_MAX_RESTARTS,
        detailRateMinMs: DETAIL_RATE_MIN_MS,
        detailRateMaxMs: DETAIL_RATE_MAX_MS,
        detailNextAllowedAt: nextDetailAllowedAt ? new Date(nextDetailAllowedAt).toISOString() : "",
        detailFallbacksDefault: false
      }
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "仅支持 POST" });
  }

  let body = {};
  try {
    body = await parseBody(req);
  } catch (error) {
    return json(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) });
  }

  if (req.url === "/api/boss/verify") {
    let cookieInfo;
    try {
      cookieInfo = await resolveRequestCookie(body);
    } catch (error) {
      return json(res, 500, { ok: false, message: "获取 Boss 会话失败", error: String(error) });
    }
    const cookie = cookieInfo.cookie;
    if (!cookie) {
      return json(res, 400, { ok: false, message: "缺少 cookie（可在请求体传 cookie，或设置环境变量 BOSS_COOKIE）" });
    }
    const referer = String(body?.referer || "https://www.zhipin.com/web/geek/jobs?query=SQE&city=101280800");
    try {
      const verify = await verifySession(cookie, referer);
      return json(res, 200, {
        ok: true,
        request: {
          referer,
          cookieMasked: maskCookie(cookie),
          cookieSource: cookieInfo.source,
          cdpUrl: cookieInfo.cdpUrl || undefined,
          cookieCount: cookieInfo.cookieCount
        },
        verify
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "调用 verify 失败", error: String(error) });
    }
  }

  if (req.url === "/api/boss/search") {
    let cookieInfo;
    try {
      cookieInfo = await resolveRequestCookie(body);
    } catch (error) {
      return json(res, 500, { ok: false, message: "获取 Boss 会话失败", error: String(error) });
    }
    const cookie = cookieInfo.cookie;
    if (!cookie) {
      return json(res, 400, { ok: false, message: "缺少 cookie（可在请求体传 cookie，或设置环境变量 BOSS_COOKIE）" });
    }
    const query = String(body?.query || "").trim();
    const city = String(body?.city || "101280800").trim();
    const page = Math.max(1, safeNumber(body?.page, 1));
    const pageSize = Math.min(10, Math.max(1, safeNumber(body?.pageSize, 10)));
    if (!query) {
      return json(res, 400, { ok: false, message: "缺少 query（关键词）" });
    }
    const filters = normalizeFilters(body?.filters || {});
    const referer = String(body?.referer || `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`);

    try {
      const prepared = await verifyAndPrepare(cookie, referer);
      if (!prepared.ok) {
        return json(res, 200, {
          ok: false,
          stage: prepared.stage,
          message: "登录态不可用，请刷新 cookie",
          request: {
            query,
            city,
            page,
            pageSize,
            cookieMasked: maskCookie(cookie),
            cookieSource: cookieInfo.source,
            cdpUrl: cookieInfo.cdpUrl || undefined,
            cookieCount: cookieInfo.cookieCount
          },
          verify: prepared.verify
        });
      }

      const jobsRaw = await searchJobs({ cookie, query, city, page, pageSize, referer });
      const jobList = Array.isArray(jobsRaw?.data?.zpData?.jobList) ? jobsRaw.data.zpData.jobList : [];
      const filteredJobs = jobList.filter((job) => matchJobFilters(job, filters));

      return json(res, 200, {
        ok: jobsRaw?.data?.code === 0,
        request: {
          query,
          city,
          page,
          pageSize,
          cookieMasked: maskCookie(cookie),
          cookieSource: cookieInfo.source,
          cdpUrl: cookieInfo.cdpUrl || undefined,
          cookieCount: cookieInfo.cookieCount
        },
        filters,
        verifyCode: prepared.verify?.data?.code ?? null,
        setTokenCode: prepared.token?.data?.code ?? null,
        searchCode: jobsRaw?.data?.code ?? null,
        searchMessage: jobsRaw?.data?.message || "",
        hasMore: Boolean(jobsRaw?.data?.zpData?.hasMore),
        totalBeforeFilter: jobList.length,
        jobCount: filteredJobs.length,
        jobs: filteredJobs.map(normalizeJob),
        hasJobDescription: false,
        raw: {
          verify: prepared.verify,
          setToken: prepared.token,
          search: jobsRaw
        }
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "调用 search 失败", error: String(error) });
    }
  }

  if (req.url === "/api/boss/searchAll") {
    let cookieInfo;
    try {
      cookieInfo = await resolveRequestCookie(body);
    } catch (error) {
      return json(res, 500, { ok: false, message: "获取 Boss 会话失败", error: String(error) });
    }
    const cookie = cookieInfo.cookie;
    if (!cookie) {
      return json(res, 400, { ok: false, message: "缺少 cookie（可在请求体传 cookie，或设置环境变量 BOSS_COOKIE）" });
    }
    const query = String(body?.query || "").trim();
    const city = String(body?.city || "101280800").trim();
    const pageSize = Math.min(10, Math.max(1, safeNumber(body?.pageSize, 10)));
    const startPage = Math.max(1, safeNumber(body?.page, 1));
    const requestedMaxPages = Math.max(1, safeNumber(body?.maxPages, 1));
    const maxPages = Math.min(requestedMaxPages, SEARCH_ALL_MAX_PAGES_HARD);
    const pagePauseMs = Math.max(0, safeNumber(body?.pagePauseMs, SEARCH_ALL_DEFAULT_PAGE_PAUSE_MS));
    const failureRestartDelayMs = Math.max(0, safeNumber(body?.failureRestartDelayMs, SEARCH_ALL_FAILURE_RESTART_DELAY_MS));
    const maxRestarts = Math.max(0, safeNumber(body?.maxRestarts, SEARCH_ALL_MAX_RESTARTS));
    const filters = normalizeFilters(body?.filters || {});
    if (!query) {
      return json(res, 400, { ok: false, message: "缺少 query（关键词）" });
    }
    const referer = String(body?.referer || `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`);

    try {
      const prepared = await verifyAndPrepare(cookie, referer);
      if (!prepared.ok) {
        return json(res, 200, {
          ok: false,
          stage: prepared.stage,
          message: "登录态不可用，请刷新 cookie",
          request: {
            query,
            city,
            startPage,
            pageSize,
            maxPages,
            pagePauseMs,
            failureRestartDelayMs,
            maxRestarts,
            cookieMasked: maskCookie(cookie),
            cookieSource: cookieInfo.source,
            cdpUrl: cookieInfo.cdpUrl || undefined,
            cookieCount: cookieInfo.cookieCount
          },
          verify: prepared.verify
        });
      }

      let allJobs = [];
      let totalBeforeFilter = 0;
      let pagesFetched = 0;
      let hasMore = true;
      let pageStats = [];
      let stopReason = "max-pages-reached";
      let lastSearchCode = null;
      let lastSearchMessage = "";
      const restartEvents = [];
      let restartCount = 0;

      while (true) {
        allJobs = [];
        totalBeforeFilter = 0;
        pagesFetched = 0;
        hasMore = true;
        pageStats = [];
        stopReason = "max-pages-reached";
        lastSearchCode = null;
        lastSearchMessage = "";

        const seen = new Set();
        let currentPage = startPage;
        try {
          while (pagesFetched < maxPages && hasMore) {
            const pageResp = await searchJobs({ cookie, query, city, page: currentPage, pageSize, referer });
            lastSearchCode = pageResp?.data?.code ?? null;
            lastSearchMessage = pageResp?.data?.message || "";
            if (lastSearchCode !== 0) {
              throw new Error(`search-code-${lastSearchCode}: ${lastSearchMessage}`);
            }

            const pageJobs = Array.isArray(pageResp?.data?.zpData?.jobList) ? pageResp.data.zpData.jobList : [];
            const filteredPageJobs = pageJobs.filter((job) => matchJobFilters(job, filters));
            totalBeforeFilter += pageJobs.length;

            for (const job of filteredPageJobs) {
              const dedupKey = `${job.securityId || ""}::${job.encryptJobId || ""}`;
              if (seen.has(dedupKey)) continue;
              seen.add(dedupKey);
              allJobs.push(job);
            }

            hasMore = Boolean(pageResp?.data?.zpData?.hasMore);
            pagesFetched += 1;
            pageStats.push({
              page: currentPage,
              totalBeforeFilter: pageJobs.length,
              totalAfterFilter: filteredPageJobs.length,
              hasMore
            });
            currentPage += 1;
            if (!hasMore) {
              stopReason = "upstream-no-more";
            } else if (pagesFetched < maxPages && pagePauseMs > 0) {
              await sleep(pagePauseMs);
            }
          }
          break;
        } catch (error) {
          stopReason = "failed-before-restart";
          if (restartCount >= maxRestarts) {
            throw error;
          }
          restartCount += 1;
          restartEvents.push({
            restart: restartCount,
            delayMs: failureRestartDelayMs,
            reason: String(error)
          });
          if (failureRestartDelayMs > 0) {
            await sleep(failureRestartDelayMs);
          }
        }
      }

      return json(res, 200, {
        ok: lastSearchCode === 0 || pagesFetched > 0,
        request: {
          query,
          city,
          startPage,
          pageSize,
          maxPages,
          pagePauseMs,
          failureRestartDelayMs,
          maxRestarts,
          restartCount,
          cookieMasked: maskCookie(cookie),
          cookieSource: cookieInfo.source,
          cdpUrl: cookieInfo.cdpUrl || undefined,
          cookieCount: cookieInfo.cookieCount
        },
        filters,
        verifyCode: prepared.verify?.data?.code ?? null,
        setTokenCode: prepared.token?.data?.code ?? null,
        searchCode: lastSearchCode,
        searchMessage: lastSearchMessage,
        pagesFetched,
        totalBeforeFilter,
        jobCount: allJobs.length,
        hasMore,
        stopReason,
        restartEvents,
        pageStats,
        jobs: allJobs.map(normalizeJob),
        hasJobDescription: false
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "调用 searchAll 失败", error: String(error) });
    }
  }

  if (req.url === "/api/boss/searchPage/visible") {
    try {
      const frontChrome = await tryReadFrontChromeTab();
      const cdpUrl = String(body?.cdpUrl || DEFAULT_CDP_URL).trim();
      const limit = Math.max(1, safeNumber(body?.limit, 5));
      const enrichDescription = body?.enrichDescription === true;
      const visible = await readVisibleJobsFromSearchPage({
        cdpUrl,
        frontChromeUrl: frontChrome.url,
        limit,
        enrichDescription
      });

      return json(res, 200, {
        ok: true,
        request: {
          cdpUrl,
          limit,
          enrichDescription
        },
        frontChrome,
        searchPageTarget: {
          title: visible.targetTitle,
          url: visible.targetUrl
        },
        totalVisible: visible.totalVisible ?? 0,
        matchedCount: visible.matchedCount ?? 0,
        jobs: Array.isArray(visible.jobs) ? visible.jobs : []
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "读取当前 Boss 搜索页可见岗位失败", error: String(error) });
    }
  }

  if (req.url === "/api/boss/domRect") {
    try {
      const cdpUrl = String(body?.cdpUrl || DEFAULT_CDP_URL).trim();
      const role = String(body?.role || "").trim();
      const selectors = normalizeArray(body?.selectors);
      if (!selectors.length) {
        return json(res, 400, { ok: false, message: "缺少 selectors（CSS 选择器数组）" });
      }

      const target = await findFrontBossPageTarget(cdpUrl);
      if (!target?.webSocketDebuggerUrl) {
        return json(res, 200, { ok: false, message: "未找到可用的 Boss 页面标签" });
      }

      const selectorJson = JSON.stringify(selectors);
      const expression = `(function() {
        var selectors = ${selectorJson};
        var role = ${JSON.stringify(role)};
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (!el) continue;
          var r = el.getBoundingClientRect();
          if (r.width < 10 || r.height < 10) continue;
          var toolbarH = window.outerHeight - window.innerHeight;
          return JSON.stringify({
            ok: true,
            role: role,
            x: Math.round(window.screenX + r.left + r.width / 2),
            y: Math.round(window.screenY + toolbarH + r.top + r.height / 2),
            w: Math.round(r.width),
            h: Math.round(r.height),
            matchedBy: selectors[i],
            pageUrl: location.href,
            windowBounds: {
              left: window.screenX,
              top: window.screenY,
              width: window.outerWidth,
              height: window.outerHeight,
              toolbarHeight: toolbarH
            }
          });
        }
        return JSON.stringify({ ok: false, role: role, message: "no matching element", pageUrl: location.href });
      })()`;

      const result = await callTargetCdpMethod(target.webSocketDebuggerUrl, "Runtime.evaluate", {
        expression,
        returnByValue: true
      });
      const value = result?.result?.value;
      const parsed = typeof value === "string" ? JSON.parse(value) : (value || { ok: false });
      return json(res, 200, parsed);
    } catch (error) {
      return json(res, 500, { ok: false, message: "domRect 调用失败", error: String(error) });
    }
  }

  if (req.url === "/api/boss/pageState") {
    try {
      const cdpUrl = String(body?.cdpUrl || DEFAULT_CDP_URL).trim();
      const target = await findFrontBossPageTarget(cdpUrl);
      if (!target?.webSocketDebuggerUrl) {
        return json(res, 200, { ok: false, message: "未找到可用的 Boss 页面标签" });
      }

      const expression = `(function() {
        var ae = document.activeElement;
        var inputFocused = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
        var inputValue = '';
        if (inputFocused) inputValue = ae.value || '';
        var url = location.href;
        return JSON.stringify({
          ok: true,
          url: url,
          readyState: document.readyState || '',
          title: document.title || '',
          isSearchPage: url.indexOf('/web/geek/jobs') !== -1,
          isBossHome: url.indexOf('zhipin.com') !== -1 && url.indexOf('/web/geek/jobs') === -1,
          isRiskPage: url.indexOf('security-check') !== -1,
          inputFocused: inputFocused,
          inputValue: inputValue,
          inputTag: ae ? ae.tagName : '',
          inputClass: ae ? (ae.className || '') : ''
        });
      })()`;

      const result = await callTargetCdpMethod(target.webSocketDebuggerUrl, "Runtime.evaluate", {
        expression,
        returnByValue: true
      });
      const value = result?.result?.value;
      const parsed = typeof value === "string" ? JSON.parse(value) : (value || { ok: false });
      return json(res, 200, parsed);
    } catch (error) {
      return json(res, 500, { ok: false, message: "pageState 调用失败", error: String(error) });
    }
  }

  if (req.url === "/api/boss/detail") {
    const detailRate = reserveDetailSlot();
    if (!detailRate.ok) {
      return json(res, 429, {
        ok: false,
        message: "职位详情接口正在冷却，请稍后再试",
        retryAfterMs: detailRate.retryAfterMs,
        retryAfterMinutes: Math.ceil(detailRate.retryAfterMs / 60_000),
        nextAllowedAt: detailRate.nextAllowedAt,
        lastCooldownMs: detailRate.lastCooldownMs
      });
    }

    let cookieInfo;
    try {
      cookieInfo = await resolveRequestCookie(body);
    } catch (error) {
      return json(res, 500, { ok: false, message: "获取 Boss 会话失败", error: String(error) });
    }
    const cookie = cookieInfo.cookie;
    if (!cookie) {
      return json(res, 400, { ok: false, message: "缺少 cookie（可在请求体传 cookie，或设置环境变量 BOSS_COOKIE）" });
    }
    const inputUrl = String(body?.url || "").trim();
    const encryptJobId = String(body?.encryptJobId || "").trim();
    const securityId = String(body?.securityId || "").trim();
    const detailUrl = normalizeDetailUrl({ url: inputUrl, encryptJobId, securityId });
    if (!detailUrl) {
      return json(res, 400, {
        ok: false,
        message: "缺少详情定位参数。请传 url，或传 encryptJobId（securityId 可选）。"
      });
    }
    const query = String(body?.query || "SQE");
    const city = String(body?.city || "101280800");
    const referer = String(body?.referer || `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(query)}&city=${encodeURIComponent(city)}`);
    const allowDetailFallbacks = body?.allowDetailFallbacks === true;

    try {
      const frontChrome = await tryReadFrontChromeTab();
      const prepared = await verifyAndPrepare(cookie, referer);
      if (!prepared.ok) {
        return json(res, 200, {
          ok: false,
          stage: prepared.stage,
          message: "登录态不可用，请刷新 cookie",
          request: {
            url: detailUrl,
            encryptJobId,
            securityId,
            cookieMasked: maskCookie(cookie),
            cookieSource: cookieInfo.source,
            cdpUrl: cookieInfo.cdpUrl || undefined,
            cookieCount: cookieInfo.cookieCount
          },
          frontChrome,
          verify: prepared.verify
        });
      }

      let searchApiAttempt = null;
      let detailResp = null;
      if (cookieInfo.source === "cdp" && cookieInfo.cdpUrl) {
        const searchApiResult = await captureDetailViaSearchPageApi({
          cdpUrl: cookieInfo.cdpUrl,
          frontChromeUrl: frontChrome.url,
          targetEncryptId: encryptJobId,
          targetSecurityId: securityId
        }).catch((error) => ({
          ok: false,
          reason: String(error)
        }));

        const apiText = String(searchApiResult?.intercepted?.responseText || "");
        let apiJson = null;
        try {
          apiJson = apiText ? JSON.parse(apiText) : null;
        } catch {
          apiJson = null;
        }
        const jsonDescription = findDescriptionInJsonPayload(apiJson);
        const activeDescription = String(searchApiResult?.activeJobInfo?.postDescription || "").trim();
        const apiDescription = jsonDescription || activeDescription;
        const apiTitle = extractTitleFromJsonPayload(apiJson) || String(searchApiResult?.activeJobInfo?.jobName || "").trim();

        searchApiAttempt = {
          mode: "search-page-detail-api",
          ok: searchApiResult?.ok === true,
          reason: searchApiResult?.reason || "",
          pageTitle: searchApiResult?.pageTitle || "",
          pageUrl: searchApiResult?.pageUrl || "",
          targetTitle: searchApiResult?.targetTitle || "",
          targetUrl: searchApiResult?.targetUrl || "",
          selectedHref: searchApiResult?.selectedHref || "",
          selectedEncryptId: searchApiResult?.selectedEncryptId || "",
          selectedSecurityId: searchApiResult?.selectedSecurityId || "",
          detailApiUrl: searchApiResult?.intercepted?.url || "",
          detailApiMethod: searchApiResult?.intercepted?.method || "",
          detailApiStatus: searchApiResult?.intercepted?.status ?? null,
          detailApiVia: searchApiResult?.intercepted?.via || "",
          descriptionSource: jsonDescription ? "detail-json" : (activeDescription ? "search-page-job-info" : ""),
          requestHeaders: sanitizeCapturedHeaders(searchApiResult?.intercepted?.requestHeaders || {}),
          responseHeaders: sanitizeCapturedHeaders(searchApiResult?.intercepted?.responseHeaders || {}),
          activeJobName: searchApiResult?.activeJobInfo?.jobName || "",
          activeEncryptId: searchApiResult?.activeJobInfo?.encryptId || "",
          activeSecurityId: searchApiResult?.activeJobInfo?.securityId || "",
          hasJobDescription: Boolean(apiDescription)
        };

        if (apiDescription) {
          detailResp = {
            httpStatus: Number(searchApiResult?.intercepted?.status || 200),
            finalUrl: searchApiResult?.intercepted?.finalUrl || searchApiResult?.selectedHref || detailUrl,
            headers: searchApiResult?.intercepted?.responseHeaders || {},
            text: `<title>${apiTitle || searchApiResult?.activeJobInfo?.jobName || ""}</title><body>职位描述\n${apiDescription}\n工作地址\n${searchApiResult?.activeJobInfo?.locationName || ""}</body>`
          };
        }
      }

      const candidateReferers = buildDetailReferers({
        referer,
        query,
        city,
        securityId,
        frontChromeUrl: frontChrome.url
      });
      const refererAttempts = [];
      let browserContextAttempt = null;
      if (!detailResp && (allowDetailFallbacks || cookieInfo.source !== "cdp")) {
        const referersToTry = allowDetailFallbacks ? candidateReferers : [referer];
        for (const ref of referersToTry) {
          const tokenResp = allowDetailFallbacks ? await setToken(cookie, ref) : { data: { code: null } };
          const resp = await callWithRetry(() => callBossText(detailUrl, {
            method: "GET",
            headers: buildHeaders({ cookie, referer: ref, xRequestedWith: false })
          }), 0);
          detailResp = resp;
          const isSecurity = resp.text.includes("security-check.html") || resp.text.includes("请稍候");
          const parsed = extractJobDescriptionFromHtml(resp.text || "");
          refererAttempts.push({
            mode: "server-fetch",
            referer: ref,
            setTokenCode: tokenResp?.data?.code ?? null,
            detailHttpStatus: resp.httpStatus,
            detailFinalUrl: resp.finalUrl,
            pageTitle: parsed.pageTitle,
            hitSecurityCheck: isSecurity,
            hasJobDescription: Boolean(parsed.description)
          });
          if (!allowDetailFallbacks || !isSecurity) break;
        }
      }

      const allServerAttemptsBlocked = refererAttempts.length > 0 && refererAttempts.every((item) => item.hitSecurityCheck === true);
      if (allowDetailFallbacks && allServerAttemptsBlocked && cookieInfo.source === "cdp" && cookieInfo.cdpUrl) {
        const browserFetch = await fetchDetailViaBrowserContext({
          cdpUrl: cookieInfo.cdpUrl,
          frontChromeUrl: frontChrome.url,
          detailUrl,
          referer: frontChrome.url || referer
        }).catch((error) => ({
          ok: false,
          reason: String(error)
        }));

        const browserHtml = String(browserFetch?.text || "");
        const browserParsed = extractJobDescriptionFromHtml(browserHtml);
        const browserHitSecurity = browserHtml.includes("security-check.html") || browserHtml.includes("请稍候");
        browserContextAttempt = {
          mode: "browser-context-fetch",
          referer: frontChrome.url || referer,
          targetUrl: browserFetch?.targetUrl || "",
          targetTitle: browserFetch?.targetTitle || "",
          detailHttpStatus: browserFetch?.status ?? null,
          detailFinalUrl: browserFetch?.finalUrl || "",
          pageTitle: browserParsed.pageTitle,
          hitSecurityCheck: browserHitSecurity,
          hasJobDescription: Boolean(browserParsed.description),
          ok: browserFetch?.ok === true,
          reason: browserFetch?.reason || browserFetch?.error || ""
        };

        if (browserFetch?.ok === true && !browserHitSecurity && browserParsed.description) {
          detailResp = {
            httpStatus: browserFetch.status,
            finalUrl: browserFetch.finalUrl,
            headers: {},
            text: browserHtml
          };
        }
      }

      let searchPageSelectionAttempt = null;
      const stillBlocked = !detailResp || String(detailResp?.text || "").includes("security-check.html") || String(detailResp?.text || "").includes("请稍候");
      if (allowDetailFallbacks && stillBlocked && cookieInfo.source === "cdp" && cookieInfo.cdpUrl) {
        const visiblePick = await readVisibleJobsFromSearchPage({
          cdpUrl: cookieInfo.cdpUrl,
          frontChromeUrl: frontChrome.url,
          limit: 12,
          enrichDescription: true,
          targetEncryptId: encryptJobId,
          targetSecurityId: securityId
        }).catch((error) => ({
          ok: false,
          error: String(error),
          jobs: []
        }));

        const picked = Array.isArray(visiblePick.jobs) ? visiblePick.jobs[0] : null;
        searchPageSelectionAttempt = {
          ok: visiblePick?.ok === true,
          pageTitle: visiblePick?.pageTitle || "",
          pageUrl: visiblePick?.pageUrl || "",
          targetTitle: visiblePick?.targetTitle || "",
          targetUrl: visiblePick?.targetUrl || "",
          matchedCount: visiblePick?.matchedCount ?? 0,
          pickedJobName: picked?.activeJobName || picked?.title || "",
          pickedEncryptId: picked?.activeEncryptId || picked?.encryptId || "",
          hasJobDescription: Boolean(picked?.postDescription),
          reason: visiblePick?.error || ""
        };

        if (picked?.postDescription) {
          const fakeBody = `职位描述\n${picked.postDescription}\n工作地址\n${picked.locationName || ""}`;
          detailResp = {
            httpStatus: 200,
            finalUrl: picked.href || detailUrl,
            headers: {},
            text: `<title>${picked.activeJobName || picked.title || ""}</title><body>${fakeBody}</body>`
          };
        }
      }

      const detailParsed = extractJobDescriptionFromHtml(detailResp?.text || "");
      const maybeSecurity = (detailResp?.text || "").includes("security-check.html")
        || (detailResp?.text || "").includes("请稍候");
      const detailState = maybeSecurity
        ? "security-check"
        : (detailParsed.description ? "job-detail" : "unknown");

      return json(res, 200, {
        ok: Boolean(detailResp) && detailResp.httpStatus >= 200 && detailResp.httpStatus < 300,
        request: {
          url: detailUrl,
          encryptJobId,
          securityId,
          query,
          city,
          allowDetailFallbacks,
          detailCooldownMs: detailRate.cooldownMs,
          detailNextAllowedAt: detailRate.nextAllowedAt,
          cookieMasked: maskCookie(cookie),
          cookieSource: cookieInfo.source,
          cdpUrl: cookieInfo.cdpUrl || undefined,
          cookieCount: cookieInfo.cookieCount
        },
        verifyCode: prepared.verify?.data?.code ?? null,
        setTokenCode: prepared.token?.data?.code ?? null,
        detailHttpStatus: detailResp?.httpStatus ?? null,
        detailFinalUrl: detailResp?.finalUrl || "",
        detailState,
        hitSecurityCheck: maybeSecurity,
        hasJobDescription: Boolean(detailParsed.description),
        pageTitle: detailParsed.pageTitle,
        jobDescription: detailParsed.description,
        plainTextPreview: detailParsed.plainTextPreview,
        frontChrome,
        searchApiAttempt,
        referersTried: refererAttempts,
        browserContextAttempt,
        searchPageSelectionAttempt
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "调用 detail 失败", error: String(error) });
    }
  }

  // ── CDP network capture: start listening for joblist.json XHR responses ──
  if (req.url === "/api/boss/searchPage/listen") {
    try {
      const cdpUrl = String(body?.cdpUrl || DEFAULT_CDP_URL).trim();
      const frontChromeUrl = String(body?.frontChromeUrl || "").trim();
      const target = await findFrontBossPageTarget(cdpUrl, frontChromeUrl);
      if (!target?.webSocketDebuggerUrl) {
        return json(res, 200, { ok: false, message: "未找到可用的 Boss 页面标签" });
      }

      const sessionId = `cap-${Date.now()}-${++_captureSessionCounter}`;
      const jobs = new Map();
      const pendingRequestIds = new Set();
      let msgIdCounter = 1001;

      const socket = new WebSocket(target.webSocketDebuggerUrl);

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ id: 1, method: "Network.enable", params: {} }));
      });

      socket.addEventListener("message", (event) => {
        let msg;
        try { msg = JSON.parse(String(event.data)); } catch { return; }

        if (msg.method === "Network.responseReceived") {
          const url = String(msg.params?.response?.url || "");
          if (url.includes("/wapi/zpgeek/search/joblist.json")) {
            pendingRequestIds.add(msg.params.requestId);
          }
        } else if (msg.method === "Network.loadingFinished") {
          const reqId = msg.params?.requestId;
          if (pendingRequestIds.has(reqId)) {
            pendingRequestIds.delete(reqId);
            const msgId = msgIdCounter++;
            socket.send(JSON.stringify({
              id: msgId,
              method: "Network.getResponseBody",
              params: { requestId: reqId }
            }));
          }
        } else if (msg.id && msg.id >= 1001 && msg.result) {
          const raw = msg.result.body;
          if (!raw) return;
          let text;
          try {
            if (msg.result.base64Encoded) {
              const buf = Buffer.from(raw, "base64");
              text = (buf[0] === 0x1f && buf[1] === 0x8b)
                ? zlib.gunzipSync(buf).toString("utf8")
                : buf.toString("utf8");
            } else {
              text = raw;
            }
            const data = JSON.parse(text);
            const list = data?.zpData?.jobList;
            if (Array.isArray(list)) {
              for (const job of list) {
                if (job?.encryptJobId) jobs.set(job.encryptJobId, job);
              }
            }
          } catch (e) { dbg("BOSS joblist.json 响应体解析失败，本批职位丢弃：", e.message); }
        }
      });

      socket.addEventListener("error", () => { });

      _captureSessions.set(sessionId, { socket, jobs, target });

      return json(res, 200, {
        ok: true,
        sessionId,
        target: { url: target.url, title: target.title }
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "启动网络监听失败", error: String(error) });
    }
  }

  // ── CDP network capture: drain accumulated jobs and close session ──
  if (req.url === "/api/boss/searchPage/drain") {
    try {
      const sessionId = String(body?.sessionId || "").trim();
      const sess = _captureSessions.get(sessionId);
      if (!sess) {
        return json(res, 200, { ok: false, message: "会话不存在或已过期", sessionId });
      }
      const jobs = Array.from(sess.jobs.values());
      try { sess.socket.close(); } catch { }
      _captureSessions.delete(sessionId);
      return json(res, 200, { ok: true, count: jobs.length, jobs });
    } catch (error) {
      return json(res, 500, { ok: false, message: "读取监听结果失败", error: String(error) });
    }
  }

  // ── Zhaopin: start CDP listen session (captures request template + jobs) ──
  if (req.url === "/api/zhaopin/search/listen") {
    try {
      const cdpUrl = String(body?.cdpUrl || DEFAULT_CDP_URL).trim();
      const target = await findFrontZhaopinPageTarget(cdpUrl);
      if (!target?.webSocketDebuggerUrl) {
        return json(res, 200, { ok: false, message: "未找到智联页面标签，请先在 Chrome 打开智联搜索结果页" });
      }

      const sessionId = `zp-${Date.now()}-${++_zhaopinSessionCounter}`;
      const jobs = new Map();
      const pendingRequestIds = new Map(); // requestId → { url, method, headers, postData }
      const msgIdToReqInfo  = new Map();   // msgId    → reqInfo（用于 getResponseBody 回调定位）
      let msgIdCounter = 5001;
      let capturedRequest = null; // 第一次捕获的请求模板（用于 replay）
      let totalJobs = 0;

      const socket = new WebSocket(target.webSocketDebuggerUrl);

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ id: 1, method: "Network.enable", params: {} }));
      });

      socket.addEventListener("message", (event) => {
        let msg;
        try { msg = JSON.parse(String(event.data)); } catch { return; }

        // 捕获请求头（用于 replay）
        if (msg.method === "Network.requestWillBeSent") {
          const url = String(msg.params?.request?.url || "");
          if (url.includes("zhaopin.com") && !url.includes(".js") && !url.includes(".css")) {
            const reqInfo = {
              url,
              method:   String(msg.params?.request?.method || "GET"),
              headers:  msg.params?.request?.headers || {},
              postData: msg.params?.request?.postData || null
            };
            pendingRequestIds.set(msg.params.requestId, reqInfo);
          }
        }

        // 标记已完成的 XHR 响应
        if (msg.method === "Network.responseReceived") {
          const url = String(msg.params?.response?.url || "");
          if (url.includes("zhaopin.com") && pendingRequestIds.has(msg.params.requestId)) {
            // 确认是 JSON 响应才取 body
            const ct = String(msg.params?.response?.headers?.["content-type"] || "").toLowerCase();
            if (ct.includes("json") || ct === "") {
              const reqId = msg.params.requestId;
              const msgId = msgIdCounter++;
              msgIdToReqInfo.set(msgId, pendingRequestIds.get(reqId));
              socket.send(JSON.stringify({
                id: msgId,
                method: "Network.getResponseBody",
                params: { requestId: reqId }
              }));
            }
          }
        }

        // 解析响应体，提取职位
        if (msg.id && msg.id >= 5001 && msg.result) {
          const raw = msg.result.body;
          if (!raw) return;
          let text;
          try {
            if (msg.result.base64Encoded) {
              const buf = Buffer.from(raw, "base64");
              text = (buf[0] === 0x1f && buf[1] === 0x8b)
                ? zlib.gunzipSync(buf).toString("utf8")
                : buf.toString("utf8");
            } else {
              text = raw;
            }
            const data = JSON.parse(text);
            const list = extractZhaopinJobs(data);
            if (list.length > 0) {
              // 第一次成功捕获时保存请求模板
              if (!capturedRequest) {
                const reqInfo = msgIdToReqInfo.get(msg.id);
                if (reqInfo) {
                  capturedRequest = {
                    ...reqInfo,
                    pageSize:  list.length,
                    totalJobs: extractZhaopinTotal(data)
                  };
                }
              }
              totalJobs = Math.max(totalJobs, extractZhaopinTotal(data));
              for (const job of list) {
                const id = String(
                  job.number || job.jobId || job.jobNumber || job.id ||
                  job.positionCode || ""
                );
                if (id) jobs.set(id, job);
              }
            }
          } catch (e) { dbg("智联 positionList 响应体解析失败，本批职位丢弃：", e.message); }
        }
      });

      socket.addEventListener("error", () => { });

      _zhaopinSessions.set(sessionId, { socket, jobs, capturedRequest: () => capturedRequest, target });

      return json(res, 200, {
        ok: true,
        sessionId,
        target: { url: target.url, title: target.title }
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "启动智联监听失败", error: String(error) });
    }
  }

  // ── Zhaopin: drain jobs + return request template ──
  if (req.url === "/api/zhaopin/search/drain") {
    try {
      const sessionId = String(body?.sessionId || "").trim();
      const sess = _zhaopinSessions.get(sessionId);
      if (!sess) {
        return json(res, 200, { ok: false, message: "智联会话不存在或已过期", sessionId });
      }
      const jobs = Array.from(sess.jobs.values());
      const capturedRequest = sess.capturedRequest();
      try { sess.socket.close(); } catch { }
      _zhaopinSessions.delete(sessionId);
      return json(res, 200, {
        ok: true,
        count: jobs.length,
        jobs,
        capturedRequest: capturedRequest
          ? {
              url:       capturedRequest.url,
              method:    capturedRequest.method,
              headers:   capturedRequest.headers || {},
              postData:  capturedRequest.postData || null,
              pageSize:  capturedRequest.pageSize,
              totalJobs: capturedRequest.totalJobs,
            }
          : null
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "读取智联监听结果失败", error: String(error) });
    }
  }

  // ── Zhaopin: replay captured request for page N ──
  // 注意：replay 使用的 capturedRequest（含完整 Cookie）存储在调用方内存，
  // 由 zhaopin-hs-rpa.mjs 传入 replayTemplate（含原始 headers）。
  if (req.url === "/api/zhaopin/search/replay") {
    try {
      const page = Number(body?.page);
      const template = body?.replayTemplate;
      if (!Number.isFinite(page) || page < 1) {
        return json(res, 400, { ok: false, message: "缺少或非法的 page 参数（1-based）" });
      }
      if (!template?.url) {
        return json(res, 400, { ok: false, message: "缺少 replayTemplate.url" });
      }
      const result = await replayZhaopinRequest(template, page);
      const jobs = extractZhaopinJobs(result.data);
      const total = extractZhaopinTotal(result.data);
      return json(res, 200, {
        ok: result.httpStatus >= 200 && result.httpStatus < 300,
        httpStatus: result.httpStatus,
        pageUrl: result.pageUrl,
        count: jobs.length,
        total,
        jobs
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: "智联 replay 失败", error: String(error) });
    }
  }

  // ── Zhaopin: extract positionList from __INITIAL_STATE__ via Runtime.evaluate ──
  if (req.url === "/api/zhaopin/search/getPage") {
    try {
      const cdpUrl     = String(body?.cdpUrl     || DEFAULT_CDP_URL).trim();
      const pageUrl    = String(body?.pageUrl    || "").trim();
      const timeoutMs  = Number(body?.timeoutMs  || 22000);
      const target = await findFrontZhaopinPageTarget(cdpUrl);
      if (!target?.webSocketDebuggerUrl) {
        return json(res, 200, { ok: false, message: "未找到智联页面，请先在 Chrome 打开智联搜索结果页" });
      }
      const result = await zhaopinGetPageState(target.webSocketDebuggerUrl, pageUrl || null, timeoutMs);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, message: "getPage 失败", error: String(error) });
    }
  }

  if (req.url === "/api/51job/job/detail") {
    // 获取前程无忧职位详情。支持两种模式：
    //   1. jobId 模式（推荐）：在已打开的搜索页点击职位标题 → 新 tab → 提取
    //      Body: { jobId, cdpUrl?, timeoutMs? }
    //   2. URL 模式（要求真实职位详情 URL，非公司页）：CDP 新 tab 导航 → 提取
    //      Body: { url: "https://jobs.51job.com/{city}/{jobId}.html", cdpUrl?, timeoutMs? }
    try {
      const jobId     = String(body?.jobId || "").trim();
      const jobUrl    = String(body?.url   || "").trim();
      const cdpUrl    = String(body?.cdpUrl || DEFAULT_CDP_URL).trim();
      const timeoutMs = Number(body?.timeoutMs || 35000);

      // jobId 模式（优先）
      if (jobId) {
        const result = await fetch51jobDetailFromSearch(cdpUrl, jobId, timeoutMs);
        return json(res, 200, result);
      }

      // URL 模式 —— 校验是否为真实职位详情页（非 /all/co 公司页）
      if (!jobUrl || !jobUrl.includes("51job.com")) {
        return json(res, 200, { ok: false, message: "必须提供 jobId 或 51job 职位 URL" });
      }
      if (jobUrl.includes("/all/co")) {
        // 公司页 URL — 尝试从 URL 中提取 jobId（公司页无 jobId，直接报错）
        return json(res, 200, {
          ok: false,
          reason: "company-url",
          message: "传入的是公司页 URL（/all/coXXX），无法提取职位详情。请使用 jobId 参数（来自搜索结果的 jobId 字段）。"
        });
      }
      // 尝试从 URL 中提取 jobId 后 fallback 到搜索页点击
      const urlJobIdMatch = jobUrl.match(/\/(\d{7,12})\.html/);
      if (urlJobIdMatch) {
        const extractedJobId = urlJobIdMatch[1];
        const result = await fetch51jobDetailFromSearch(cdpUrl, extractedJobId, timeoutMs).catch(() => null);
        if (result?.ok) return json(res, 200, result);
        // 搜索页没找到（可能不在当前页），退回到直接导航
      }
      const result = await fetch51jobDetailCDP(cdpUrl, jobUrl, timeoutMs);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, message: "51job 职位详情获取失败", error: String(error) });
    }
  }

  if (req.url === "/api/51job/search/nextPage") {
    try {
      const cdpUrl     = String(body?.cdpUrl     || DEFAULT_CDP_URL).trim();
      const targetPage = Number(body?.targetPage || 2);
      const timeoutMs  = Number(body?.timeoutMs  || 25000);
      if (targetPage < 2) {
        return json(res, 200, { ok: false, message: "targetPage 必须 >= 2，第1页请用 getPage" });
      }
      const target = await findFront51jobPageTarget(cdpUrl);
      if (!target?.webSocketDebuggerUrl) {
        return json(res, 200, { ok: false, message: "未找到前程无忧页面" });
      }
      const result = await job51NextPage(target.webSocketDebuggerUrl, targetPage, timeoutMs);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, message: "51job nextPage 失败", error: String(error) });
    }
  }

  if (req.url === "/api/51job/search/getPage") {
    try {
      const cdpUrl    = String(body?.cdpUrl    || DEFAULT_CDP_URL).trim();
      const pageUrl   = String(body?.pageUrl   || "").trim();
      const timeoutMs = Number(body?.timeoutMs || 25000);
      if (!pageUrl) {
        return json(res, 200, { ok: false, message: "pageUrl 必填：传入前程无忧搜索结果页 URL" });
      }
      const target = await findFront51jobPageTarget(cdpUrl);
      if (!target?.webSocketDebuggerUrl) {
        return json(res, 200, { ok: false, message: "未找到前程无忧页面，请先在 Chrome 打开前程无忧搜索结果页" });
      }
      const result = await job51GetPageState(target.webSocketDebuggerUrl, pageUrl, timeoutMs);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, message: "51job getPage 失败", error: String(error) });
    }
  }

  if (req.url === "/api/liepin/search/getPage") {
    try {
      const cdpUrl    = String(body?.cdpUrl    || DEFAULT_CDP_URL).trim();
      const pageUrl   = String(body?.pageUrl   || "").trim();
      const timeoutMs = Number(body?.timeoutMs || 25000);
      const target = await findFrontLiepinPageTarget(cdpUrl);
      if (!target?.webSocketDebuggerUrl) {
        return json(res, 200, { ok: false, message: "未找到猎聘页面，请先在 Chrome 打开 liepin.com 搜索结果页" });
      }
      const result = await liepinGetPageState(target.webSocketDebuggerUrl, pageUrl || null, timeoutMs);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, message: "liepin getPage 失败", error: String(error) });
    }
  }

  if (req.url === "/api/liepin/job/detail") {
    // 获取单个职位的 JD 详情（SSR HTML 解析，无需浏览器）
    // Body: { url }
    try {
      const jobUrl = String(body?.url || "").trim();
      if (!jobUrl || !jobUrl.includes("liepin.com")) {
        return json(res, 200, { ok: false, message: "url 必填，且须为猎聘职位链接" });
      }
      const result = await liepinFetchJobDetail(jobUrl);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, message: "liepin 职位详情获取失败", error: String(error) });
    }
  }

  if (req.url === "/api/liepin/job/detail/cdp") {
    // 通过 CDP 导航到猎聘职位详情页提取 JD（解决直接 HTTP 302 重定向问题）
    // Body: { url, cdpUrl?, timeoutMs? }
    try {
      const jobUrl    = String(body?.url || "").trim();
      const cdpUrl    = String(body?.cdpUrl || DEFAULT_CDP_URL).trim();
      const timeoutMs = Number(body?.timeoutMs || 20000);
      if (!jobUrl || !jobUrl.includes("liepin.com")) {
        return json(res, 200, { ok: false, message: "url 必填，且须为猎聘职位链接" });
      }
      const result = await liepinFetchJobDetailCDP(cdpUrl, jobUrl, timeoutMs);
      return json(res, 200, result);
    } catch (error) {
      return json(res, 500, { ok: false, message: "liepin CDP 职位详情获取失败", error: String(error) });
    }
  }

  if (req.url === "/api/liepin/search/getPageAPI") {
    // 纯接口模式：无需浏览器/CDP，直接调用猎聘搜索 API
    // Body: { query, city, page, cookieJar?, xsrfToken? }
    // 如果不传 cookieJar，服务端自动先获取 Cookie
    try {
      const query      = String(body?.query || "").trim();
      const city       = String(body?.city  || "010").trim();
      const page       = Number(body?.page  ?? 0);
      if (!query) return json(res, 200, { ok: false, message: "query 必填" });

      let cookieJar  = String(body?.cookieJar  || "").trim();
      let xsrfToken  = String(body?.xsrfToken  || "").trim();
      if (!cookieJar || !xsrfToken) {
        const got = await liepinGetCookies(city);
        cookieJar = got.cookieJar;
        xsrfToken = got.xsrfToken;
      }
      const result = await liepinApiSearchPage({ query, city, page, cookieJar, xsrfToken });
      return json(res, 200, { ...result, cookieJar, xsrfToken });
    } catch (error) {
      return json(res, 500, { ok: false, message: "liepin API 模式失败", error: String(error) });
    }
  }

  return json(res, 404, { ok: false, message: "接口不存在" });
});

server.listen(PORT, () => {
  console.log(JSON.stringify({
    ok: true,
    message: "Boss API 服务已启动",
    port: PORT,
    endpoints: [
      "GET /health",
      "POST /api/boss/verify",
      "POST /api/boss/search",
      "POST /api/boss/searchAll",
      "POST /api/boss/searchPage/visible",
      "POST /api/boss/searchPage/listen",
      "POST /api/boss/searchPage/drain",
      "POST /api/boss/domRect",
      "POST /api/boss/pageState",
      "POST /api/boss/detail",
      "POST /api/zhaopin/search/getPage",
      "POST /api/zhaopin/search/listen",
      "POST /api/zhaopin/search/drain",
      "POST /api/zhaopin/search/replay",
      "POST /api/51job/job/detail",
      "POST /api/51job/search/getPage",
      "POST /api/51job/search/nextPage",
      "POST /api/liepin/search/getPage",
      "POST /api/liepin/search/getPageAPI",
      "POST /api/liepin/job/detail",
      "POST /api/liepin/job/detail/cdp"
    ],
    authMode: API_KEY ? "api-key-required" : "no-auth",
    hasDefaultCookie: Boolean(DEFAULT_COOKIE),
    insecureTls: INSECURE_TLS
  }, null, 2));
});
