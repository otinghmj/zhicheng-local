import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

const FALLBACK_PORTS = [9223, 9222, 9224];
const USER_DATA_DIR = `${os.homedir()}/chrome-boss-debug`;

function findChromePath() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  if (os.platform() === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
    for (const p of candidates) { if (existsSync(p)) return p; }
  }
  if (os.platform() === 'win32') {
    const candidates = [
      `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
    for (const p of candidates) { if (p && existsSync(p)) return p; }
  }
  if (os.platform() === 'linux') {
    const candidates = ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'];
    for (const name of candidates) {
      try {
        const p = execSync(`which ${name}`, { encoding: 'utf8' }).trim();
        if (p) return p;
      } catch { /* not found */ }
    }
  }
  return null;
}

const CHROME_PATH = findChromePath();

let _cdpMsgId = 0;

const PLATFORM_LOGIN = {
  boss: {
    name: 'BOSS直聘',
    domain: '.zhipin.com',
    loginUrl: 'https://www.zhipin.com/web/user/?ka=header-login',
    authCookies: ['wt2'],
  },
  zhaopin: {
    name: '智联招聘',
    domain: '.zhaopin.com',
    loginUrl: 'https://passport.zhaopin.com/login',
    authCookies: ['at', 'rt'],
    requireAll: true,
  },
  '51job': {
    name: '前程无忧',
    domain: '.51job.com',
    loginUrl: 'https://we.51job.com/pc/login',
    authCookies: ['acw_sc__v2', 'guid'],
  },
  liepin: {
    name: '猎聘',
    domain: '.liepin.com',
    loginUrl: 'https://www.liepin.com/login/',
    authCookies: ['lt_auth', 'UniqueKey', 'liepin_login_valid', '__lg_stoken__', 'lpusertoken'],
  },
};

async function probeCdp(url) {
  try {
    const response = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (response.ok) return await response.json();
  } catch { /* ignore */ }
  return null;
}

async function scanPorts() {
  for (const port of FALLBACK_PORTS) {
    const url = `http://127.0.0.1:${port}`;
    const info = await probeCdp(url);
    if (info) return { cdpUrl: url, browser: info.Browser ?? 'Chrome' };
  }
  return null;
}

async function getPages(cdpUrl) {
  try {
    const response = await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(2000) });
    const pages = await response.json();
    return pages.filter((p) => p.type === 'page');
  } catch { return []; }
}

function cdpWsCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = ++_cdpMsgId;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id, method, params })));
    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.close();
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
    ws.addEventListener('error', (e) => reject(new Error(String(e))));
    setTimeout(() => { ws.close(); reject(new Error(`CDP timeout: ${method}`)); }, 5000);
  });
}

async function cdpBrowserCall(cdpUrl, method, params = {}) {
  const version = await fetch(`${cdpUrl}/json/version`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json());
  return cdpWsCall(version.webSocketDebuggerUrl, method, params);
}

function cdpNetworkGetCookies(wsUrl, urls) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const results = {};
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.enable', params: {} }));
      ws.send(JSON.stringify({ id: 2, method: 'Network.getCookies', params: urls ? { urls } : {} }));
    });
    ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id === 1 || msg.id === 2) results[msg.id] = msg;
      if (results[1] && results[2]) {
        ws.close();
        resolve(results[2].result?.cookies ?? []);
      }
    });
    ws.addEventListener('error', (e) => reject(new Error(String(e))));
    setTimeout(() => { ws.close(); reject(new Error('cookie timeout')); }, 5000);
  });
}

async function getDomainCookies(cdpUrl, domain) {
  const pages = await getPages(cdpUrl);
  let wsUrl = pages[0]?.webSocketDebuggerUrl ?? null;
  let tempTabId = null;

  if (!wsUrl) {
    try {
      const r = await cdpBrowserCall(cdpUrl, 'Target.createTarget', { url: 'about:blank' });
      tempTabId = r?.targetId ?? null;
      await new Promise((res) => setTimeout(res, 800));
      const updated = await getPages(cdpUrl);
      wsUrl = updated.find((p) => p.id === tempTabId)?.webSocketDebuggerUrl ?? null;
    } catch { /* ignore */ }
  }

  if (!wsUrl) return [];

  const domainBase = domain.replace(/^\./, '');
  const targetUrls = [`https://${domainBase}/`, `https://www.${domainBase}/`];
  let cookies = [];
  try {
    cookies = await cdpNetworkGetCookies(wsUrl, targetUrls);
  } catch { /* ignore */ }

  if (tempTabId) {
    await cdpBrowserCall(cdpUrl, 'Target.closeTarget', { targetId: tempTabId }).catch(() => {});
  }

  return cookies.filter((c) => c.domain.includes(domainBase));
}

function hasValidAuthCookie(cookies, authCookieNames, requireAll = false) {
  const now = Date.now() / 1000;
  const isValid = (name) =>
    cookies.some((c) => c.name === name && c.value && (c.expires <= 0 || c.expires > now));
  return requireAll
    ? authCookieNames.every(isValid)
    : authCookieNames.some(isValid);
}

async function checkPlatformLogin(cdpUrl, platformKey) {
  const config = PLATFORM_LOGIN[platformKey];
  if (!config) return 'unchecked';
  try {
    const cookies = await getDomainCookies(cdpUrl, config.domain);
    return hasValidAuthCookie(cookies, config.authCookies, config.requireAll) ? 'logged_in' : 'need_login';
  } catch {
    return 'unknown';
  }
}

export async function getCdpStatus(platforms = []) {
  const found = await scanPorts();
  if (!found) {
    const result = { chrome: 'not_running', cdpUrl: null, browser: null, platforms: {} };
    for (const key of platforms) result.platforms[key] = 'unchecked';
    return result;
  }

  const result = { chrome: 'ready', cdpUrl: found.cdpUrl, browser: found.browser, platforms: {} };

  const checks = platforms.map(async (key) => {
    result.platforms[key] = await checkPlatformLogin(found.cdpUrl, key);
  });
  await Promise.all(checks);

  return result;
}

export async function launchDebugChrome() {
  const existing = await scanPorts();
  if (existing) return { success: true, cdpUrl: existing.cdpUrl, already: true };

  if (!CHROME_PATH) {
    return { success: false, error: '未找到 Chrome/Chromium，请先安装 Google Chrome 或 Chromium' };
  }

  const port = String(FALLBACK_PORTS[0]);
  try {
    const child = spawn(
      CHROME_PATH,
      [`--user-data-dir=${USER_DATA_DIR}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check'],
      { stdio: 'ignore', detached: true },
    );
    child.unref();
  } catch (error) {
    return { success: false, error: `启动 Chrome 失败：${error.message}` };
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const info = await probeCdp(`http://127.0.0.1:${port}`);
    if (info) return { success: true, cdpUrl: `http://127.0.0.1:${port}` };
  }

  return { success: false, error: '启动超时，请检查 Chrome 是否已安装' };
}

export async function openLoginPage(platformKey) {
  const config = PLATFORM_LOGIN[platformKey];
  if (!config) return { success: false, error: `不支持的平台：${platformKey}` };

  const found = await scanPorts();
  if (!found) return { success: false, error: '调试浏览器未运行' };

  try {
    await cdpBrowserCall(found.cdpUrl, 'Target.createTarget', { url: config.loginUrl });
    return { success: true, loginUrl: config.loginUrl };
  } catch (error) {
    return { success: false, error: `打开登录页失败：${error.message}` };
  }
}

export { PLATFORM_LOGIN };
