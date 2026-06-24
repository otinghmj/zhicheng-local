import { useCallback, useEffect, useRef, useState } from 'react';

type ChromeState = 'ready' | 'not_running' | 'launching';
type LoginState = 'logged_in' | 'need_login' | 'unchecked' | 'unknown';

export type CdpStatus = {
  chrome: ChromeState;
  cdpUrl: string | null;
  browser: string | null;
  platforms: Record<string, LoginState>;
};

type CdpHookState = {
  status: CdpStatus;
  loading: boolean;
  launching: boolean;
};

const EMPTY: CdpStatus = { chrome: 'not_running', cdpUrl: null, browser: null, platforms: {} };
const CDP_PORTS = [9222, 9223, 9224];

let cachedStatus: CdpStatus | null = null;

function isLocalServer(): boolean {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
}

async function probeLocalCdp(): Promise<{ cdpUrl: string; browser: string } | null> {
  for (const port of CDP_PORTS) {
    const url = `http://localhost:${port}`;
    try {
      const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        const info = await r.json();
        return { cdpUrl: url, browser: info.Browser ?? 'Chrome' };
      }
    } catch { /* CORS or network error — try opaque probe */ }
    try {
      const r = await fetch(`${url}/json/version`, { mode: 'no-cors', signal: AbortSignal.timeout(1500) });
      if (r.type === 'opaque') return { cdpUrl: url, browser: 'Chrome' };
    } catch { /* truly not available */ }
  }
  return null;
}

export function useCdpStatus(platforms: string[] = []) {
  const [state, setState] = useState<CdpHookState>({
    status: cachedStatus ?? EMPTY,
    loading: !cachedStatus,
    launching: false,
  });
  const mountedRef = useRef(true);
  const platformsKey = platforms.sort().join(',');

  const fetchStatus = useCallback(async () => {
    if (isLocalServer()) {
      try {
        const qs = platformsKey ? `?platforms=${platformsKey}` : '';
        const response = await fetch(`/api/cdp/status${qs}`);
        if (!response.ok) throw new Error(`${response.status}`);
        const data = await response.json() as CdpStatus;
        cachedStatus = data;
        if (mountedRef.current) setState((prev) => ({ ...prev, status: data, loading: false }));
        return data;
      } catch {
        if (mountedRef.current) setState((prev) => ({ ...prev, loading: false }));
        return null;
      }
    }

    // Remote mode: probe local CDP ports directly from browser
    const found = await probeLocalCdp();
    const data: CdpStatus = found
      ? { chrome: 'ready', cdpUrl: found.cdpUrl, browser: found.browser, platforms: {} }
      : { ...EMPTY, platforms: {} };
    for (const p of platforms) data.platforms[p] = 'unchecked';
    cachedStatus = data;
    if (mountedRef.current) setState((prev) => ({ ...prev, status: data, loading: false }));
    return data;
  }, [platformsKey, platforms]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchStatus();
    return () => { mountedRef.current = false; };
  }, [fetchStatus]);

  const refresh = useCallback(() => fetchStatus(), [fetchStatus]);

  const poll = useCallback(async (condition: (s: CdpStatus) => boolean, maxMs = 12000) => {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const data = await fetchStatus();
      if (data && condition(data)) return data;
    }
    return null;
  }, [fetchStatus]);

  const launch = useCallback(async () => {
    setState((prev) => ({ ...prev, launching: true }));
    try {
      const response = await fetch('/api/cdp/launch', { method: 'POST' });
      const result = await response.json() as { success: boolean; queued?: boolean; cdpUrl?: string; error?: string; code?: string };
      if (!result.success) {
        if (mountedRef.current) setState((prev) => ({ ...prev, launching: false }));
        return result;
      }
      // Both direct launch and queued (Agent) launch: poll until Chrome is detected
      await poll((s) => s.chrome === 'ready');
      if (mountedRef.current) setState((prev) => ({ ...prev, launching: false }));
      return result;
    } catch (error) {
      if (mountedRef.current) setState((prev) => ({ ...prev, launching: false }));
      return { success: false, error: String(error) };
    }
  }, [poll]);

  const openLogin = useCallback(async (platform: string) => {
    if (isLocalServer()) {
      try {
        const response = await fetch('/api/cdp/open-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform }),
        });
        const result = await response.json() as { success: boolean; error?: string };
        if (result.success) {
          void poll((s) => s.platforms[platform] === 'logged_in', 120000);
        }
        return result;
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    // Remote mode: open login URL in new tab
    const LOGIN_URLS: Record<string, string> = {
      boss: 'https://www.zhipin.com/web/user/?ka=header-login',
      zhaopin: 'https://passport.zhaopin.com/login',
      '51job': 'https://we.51job.com/pc/login',
      liepin: 'https://www.liepin.com/login/',
    };
    const url = LOGIN_URLS[platform];
    if (url) window.open(url, '_blank');
    return { success: true };
  }, [poll]);

  return {
    ...state.status,
    loading: state.loading,
    launching: state.launching,
    refresh,
    launch,
    openLogin,
  };
}
