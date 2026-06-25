/**
 * check-login.mjs
 * 采集前登录状态检测模块
 *
 * 工作原理：
 *   1. 通过 CDP Storage.getCookies 快速预检 auth cookie 是否存在
 *   2. 若 cookie 存在，在浏览器上下文（Runtime.evaluate）内发一个轻量 API 请求验证有效性
 *      （绕过直接 HTTP 被拦截的问题，如 51job 的 antidom.js）
 *   3. 未登录时：CDP 打开登录页，终端提示，每 3 秒自动轮询直到检测到已登录
 *
 * 导出：
 *   ensureLoggedIn(platform, opts)      → Promise<void>
 *   extractCookiesAsString(cdpUrl, domain) → Promise<{ cookieJar, xsrfToken }>
 *
 * 支持平台：51job | liepin
 */

// ── 各平台配置 ───────────────────────────────────────────────────────────────
const PLATFORM_CONFIG = {
  "51job": {
    name: "前程无忧",
    domain: ".51job.com",
    loginUrl: "https://we.51job.com/pc/login",
    postLoginUrlPattern: /51job\.com(?!\/pc\/login)/,
    authCookies: ["acw_sc__v2", "guid"],
    // 51job 在登录态下搜索接口有 uid 字段
    verifyScript: `(async () => {
      try {
        const r = await fetch('/api/user/getUserInfo', {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        });
        if (r.status === 401 || r.redirected) return 'need_login';
        const d = await r.json();
        return (d?.status === '1' || d?.userId) ? 'ok' : 'need_login';
      } catch { return 'need_login'; }
    })()`,
    loginSuccessCookies: ["acw_sc__v2"],
  },

  liepin: {
    name: "猎聘",
    domain: ".liepin.com",
    loginUrl: "https://www.liepin.com/login/",
    postLoginUrlPattern: /liepin\.com(?!\/login)/,
    // 猎聘登录后会设置用户身份 cookie（2026-05 实测：lt_auth + UniqueKey 为主要持久 cookie）
    authCookies: ["lt_auth", "UniqueKey", "liepin_login_valid", "__lg_stoken__", "lpusertoken"],
    verifyScript: `(async () => {
      try {
        const r = await fetch('/api/auth/checkLogin', {
          credentials: 'include',
          headers: { 'Accept': 'application/json', 'X-Client-Type': 'web' }
        });
        const d = await r.json();
        // flag=1 且有 userId 表示已登录
        if (d?.flag === 1 && d?.data?.userId) return 'ok';
        return 'need_login';
      } catch { return 'need_login'; }
    })()`,
    loginSuccessCookies: ["lt_auth", "UniqueKey", "liepin_login_valid"],
  },
};

// ── CDP 工具函数 ──────────────────────────────────────────────────────────────

/** 连接到 CDP browser endpoint，调用方法 */
async function cdpBrowserCall(cdpUrl, method, params = {}) {
  const version = await fetch(`${cdpUrl}/json/version`).then((r) => r.json());
  return cdpWsCall(version.webSocketDebuggerUrl, method, params);
}

/** 通过 WebSocket 调用 CDP 方法 */
function cdpWsCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = Date.now();
    ws.addEventListener("open", () => ws.send(JSON.stringify({ id, method, params })));
    ws.addEventListener("message", ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    ws.addEventListener("error", (e) => reject(new Error(String(e))));
    setTimeout(() => { ws.close(); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
  });
}

/**
 * 在页面级 WebSocket 上先 Network.enable 再 Network.getCookies，
 * 两个命令复用同一个 WS 连接以保证 enable 生效后立即取 cookie。
 * urls 参数可指定目标域名 URL，从而跨域取 cookie（即使当前标签页不在该域）。
 */
function cdpNetworkGetCookies(wsUrl, urls) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = {};
    const cookiesParams = urls ? { urls } : {};
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Network.enable",      params: {} }));
      ws.send(JSON.stringify({ id: 2, method: "Network.getCookies",  params: cookiesParams }));
    });
    ws.addEventListener("message", ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id === 1 || msg.id === 2) results[msg.id] = msg;
      if (results[1] && results[2]) {
        ws.close();
        resolve(results[2].result?.cookies ?? []);
      }
    });
    ws.addEventListener("error", (e) => reject(new Error(String(e))));
    setTimeout(() => { ws.close(); reject(new Error("cdpNetworkGetCookies timeout")); }, 8000);
  });
}

/** 获取所有打开的 tab pages */
async function getPages(cdpUrl) {
  const pages = await fetch(`${cdpUrl}/json`).then((r) => r.json()).catch(() => []);
  return pages.filter((p) => p.type === "page");
}

/** 在指定 tab 上执行 JS，返回 string 结果 */
async function evalInPage(wsUrl, script) {
  const result = await cdpWsCall(wsUrl, "Runtime.evaluate", {
    expression: script,
    awaitPromise: true,
    returnByValue: true,
    timeout: 10000,
  });
  return result?.result?.value ?? null;
}

/** 用 CDP 打开新 tab 并导航到指定 URL，返回 targetId */
async function openTab(cdpUrl, url) {
  const result = await cdpBrowserCall(cdpUrl, "Target.createTarget", { url });
  return result.targetId;
}

/** 根据 targetId 获取 wsDebuggerUrl */
async function getTabWsUrl(cdpUrl, targetId) {
  const pages = await fetch(`${cdpUrl}/json`).then((r) => r.json()).catch(() => []);
  const page = pages.find((p) => p.id === targetId);
  return page?.webSocketDebuggerUrl ?? null;
}

// ── Cookie 检查 ───────────────────────────────────────────────────────────────

/**
 * 从 CDP 获取指定域名的所有 cookie。
 *
 * 注意：browser-level 的 Storage.getCookies 在 debug Chrome 没有真实页面标签时
 * 会超时（WebSocket 永远不返回）。改用任意已打开页面的 Network.getCookies，
 * 若无任何页面则临时打开 about:blank 再关闭。
 */
async function getDomainCookies(cdpUrl, domain) {
  const pages = await getPages(cdpUrl);

  // 找一个可用页面的 wsDebuggerUrl
  let wsUrl = pages[0]?.webSocketDebuggerUrl ?? null;
  let tempTabId = null;

  if (!wsUrl) {
    // 没有真实页面，打开 about:blank 获取 wsUrl
    try {
      const r = await cdpBrowserCall(cdpUrl, "Target.createTarget", { url: "about:blank" });
      tempTabId = r?.targetId ?? null;
      await new Promise((res) => setTimeout(res, 800));
      const updated = await getPages(cdpUrl);
      wsUrl = updated.find((p) => p.id === tempTabId)?.webSocketDebuggerUrl ?? null;
    } catch {}
  }

  if (!wsUrl) return []; // 实在拿不到，返回空

  // Network.getCookies 传入目标域名 URL，确保跨域也能取到 cookie
  const domainBase = domain.replace(/^\./, "");
  const targetUrls = [`https://${domainBase}/`, `https://www.${domainBase}/`];
  let cookies = [];
  try {
    cookies = await cdpNetworkGetCookies(wsUrl, targetUrls);
  } catch {}

  // 关闭临时 tab
  if (tempTabId) {
    await cdpBrowserCall(cdpUrl, "Target.closeTarget", { targetId: tempTabId }).catch(() => {});
  }

  return cookies.filter((c) => c.domain.includes(domain.replace(/^\./, "")));
}

/** 检查 auth cookie 是否存在且未过期 */
function hasValidAuthCookie(cookies, authCookieNames) {
  const now = Date.now() / 1000;
  return authCookieNames.some((name) =>
    cookies.some(
      (c) => c.name === name && c.value && (c.expires <= 0 || c.expires > now)
    )
  );
}

// ── 核心逻辑 ─────────────────────────────────────────────────────────────────

/**
 * 在浏览器上下文内验证登录状态。
 * 优先用当前已打开的该平台页面；若无，临时导航到平台主页验证后关闭。
 */
async function verifyLoginInBrowser(cdpUrl, config) {
  const pages = await getPages(cdpUrl);
  const domainBase = config.domain.replace(/^\./, "");

  // 找已有的该平台页面（优先用，不打扰用户）
  let targetPage = pages.find((p) => p.url && p.url.includes(domainBase));
  let ownedTabId = null;

  if (!targetPage) {
    // 没有该平台页面，打开主页验证
    const mainUrl = new URL(config.loginUrl).origin + "/";
    ownedTabId = await openTab(cdpUrl, mainUrl);
    // 等待页面加载
    await new Promise((r) => setTimeout(r, 3000));
    const updatedPages = await getPages(cdpUrl);
    targetPage = updatedPages.find((p) => p.id === ownedTabId);
  }

  if (!targetPage?.webSocketDebuggerUrl) return "need_login";

  let result = "need_login";
  try {
    result = await evalInPage(targetPage.webSocketDebuggerUrl, config.verifyScript);
  } catch {
    result = "need_login";
  }

  // 关闭我们临时打开的 tab
  if (ownedTabId) {
    await cdpBrowserCall(cdpUrl, "Target.closeTarget", { targetId: ownedTabId }).catch(() => {});
  }

  return result;
}

/**
 * 轮询等待用户完成登录。
 * 每 POLL_INTERVAL 毫秒检查一次登录 cookie 是否出现。
 */
async function waitForLogin(cdpUrl, config, { timeoutMs = 1_800_000, pollMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  process.stderr.write(`\n等待在 Chrome 中完成 ${config.name} 登录`);

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    process.stderr.write(".");

    const cookies = await getDomainCookies(cdpUrl, config.domain);
    if (hasValidAuthCookie(cookies, config.loginSuccessCookies)) {
      process.stderr.write(` ✅ 检测到登录成功\n`);
      return true;
    }
  }

  process.stderr.write(` ❌ 超时（${timeoutMs / 1000}s）\n`);
  return false;
}

// ── 对外接口 ──────────────────────────────────────────────────────────────────

/**
 * 确保指定平台处于已登录状态，否则引导用户手动登录。
 *
 * @param {string} platform  "51job" | "liepin"
 * @param {object} opts
 *   @param {string}  opts.cdpUrl        CDP 地址（默认 http://127.0.0.1:9223）
 *   @param {string}  opts.scriptName    日志前缀
 *   @param {boolean} opts.skipVerify    仅做 cookie 预检，跳过浏览器内 API 验证（更快但不精确）
 *   @param {number}  opts.loginTimeout  等待用户登录的超时毫秒（默认 5 分钟）
 */
export async function ensureLoggedIn(platform, {
  cdpUrl = "http://127.0.0.1:9223",
  scriptName = platform,
  skipVerify = false,
  loginTimeout = 1_800_000,
  throwOnTimeout = false, // true = 超时时 throw Error，false = process.exit(1)
} = {}) {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    console.error(`[${scriptName}] ⚠️  check-login: 不支持平台 "${platform}"，跳过检查`);
    return;
  }

  console.error(`[${scriptName}] 🔍 检查 ${config.name} 登录状态...`);

  // ── Step 1: Cookie 快速预检 ──────────────────────────────────────────────
  const cookies = await getDomainCookies(cdpUrl, config.domain);
  const cookieOk = hasValidAuthCookie(cookies, config.authCookies);

  if (!cookieOk) {
    console.error(`[${scriptName}] ❌ ${config.name} 未登录（无 auth cookie）`);
    await promptLogin(cdpUrl, config, scriptName, loginTimeout, throwOnTimeout);
    return;
  }

  // ── Step 2: 浏览器内 API 验证（skipVerify 时跳过）───────────────────────
  if (!skipVerify) {
    let verifyResult = "ok";
    try {
      verifyResult = await verifyLoginInBrowser(cdpUrl, config);
    } catch (e) {
      console.error(`[${scriptName}] ⚠️  API 验证失败（${e.message}），基于 cookie 继续...`);
      verifyResult = "ok"; // cookie 存在但验证失败时，乐观继续
    }

    if (verifyResult !== "ok") {
      console.error(`[${scriptName}] ❌ ${config.name} 登录态已过期（API 返回未登录）`);
      await promptLogin(cdpUrl, config, scriptName, loginTimeout, throwOnTimeout);
      return;
    }
  }

  console.error(`[${scriptName}] ✅ ${config.name} 已登录`);
}

/**
 * 从 Chrome 中提取指定域名的所有 cookie，格式化为 HTTP Cookie 头字符串。
 * 同时提取 XSRF-TOKEN 供猎聘 API 使用。
 *
 * @param {string} cdpUrl  CDP 地址（默认 http://127.0.0.1:9223）
 * @param {string} domain  目标域名（如 ".liepin.com"）
 * @returns {Promise<{ cookieJar: string, xsrfToken: string }>}
 */
/**
 * 从 Chrome 中提取指定域名的所有 cookie，格式化为 HTTP Cookie 头字符串。
 * 同时返回原始 cookie 对象数组（含 expires 字段），供调用方判断有效期。
 *
 * @returns {{ cookieJar: string, xsrfToken: string, rawCookies: object[] }}
 */
export async function extractCookiesAsString(cdpUrl = "http://127.0.0.1:9223", domain = ".liepin.com") {
  const cookies = await getDomainCookies(cdpUrl, domain);
  const cookieJar = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const xsrfToken = cookies.find((c) => c.name === "XSRF-TOKEN")?.value || "";
  return { cookieJar, xsrfToken, rawCookies: cookies };
}

/** 打开登录页并等待用户完成登录 */
async function promptLogin(cdpUrl, config, scriptName, timeoutMs, throwOnTimeout = false) {
  console.error(`[${scriptName}] 🌐 正在 Chrome 中打开 ${config.name} 登录页...`);
  console.error(`[${scriptName}]    ${config.loginUrl}`);

  // 用 CDP 打开登录页
  const tabId = await openTab(cdpUrl, config.loginUrl).catch(() => null);
  if (!tabId) {
    console.error(`[${scriptName}] ⚠️  无法自动打开登录页，请手动在 Chrome 中访问：${config.loginUrl}`);
  }

  const success = await waitForLogin(cdpUrl, config, { timeoutMs, pollMs: 3000 });

  if (!success) {
    const msg = `[${scriptName}] ❌ 登录等待超时，请先在 Chrome 中完成 ${config.name} 登录后重新运行脚本`;
    console.error(msg);
    if (throwOnTimeout) throw new Error(msg);
    process.exit(1);
  }

  // 登录完成后关闭登录 tab（可选，保留更自然）
  if (tabId) {
    await cdpBrowserCall(cdpUrl, "Target.closeTarget", { targetId: tabId }).catch(() => {});
  }
}
