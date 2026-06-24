import { useEffect, useState } from 'react';

export type DoctorCheck = {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail' | 'unknown';
  detail?: string;
};

type DoctorState = {
  checks: DoctorCheck[];
  loading: boolean;
  detected: boolean;
};

let cachedState: DoctorState | null = null;
let doctorRequest: Promise<DoctorState> | null = null;

function normalizeChecks(value: unknown): DoctorCheck[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Record<string, unknown>;
    const label = typeof source.label === 'string' ? source.label : '';
    if (!label) return [];
    const rawStatus = typeof source.status === 'string' ? source.status : 'unknown';
    const status = ['ok', 'warn', 'fail'].includes(rawStatus) ? rawStatus : 'unknown';
    return [{
      id: typeof source.id === 'string' ? source.id : label,
      label,
      status: status as DoctorCheck['status'],
      detail: typeof source.detail === 'string' ? source.detail : undefined,
    }];
  });
}

function extractChecks(payload: unknown) {
  if (!payload || typeof payload !== 'object') return [];
  const source = payload as Record<string, unknown>;
  const direct = normalizeChecks(source.checks);
  if (direct.length) return direct;

  for (const key of ['stdout', 'output', 'result']) {
    const value = source[key];
    if (typeof value !== 'string') continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const checks = normalizeChecks(parsed.checks);
      if (checks.length) return checks;
    } catch {
      // Doctor 输出不是 JSON 时保持“未检测”，避免把文本误判为状态。
    }
  }
  return [];
}

async function loadDoctorState(): Promise<DoctorState> {
  try {
    const response = await fetch('/api/scripts/doctor?sync=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: ['--json'] }),
    });
    if (!response.ok) throw new Error(`Doctor 请求失败：${response.status}`);
    const checks = extractChecks(await response.json());
    return { checks, loading: false, detected: checks.length > 0 };
  } catch {
    return { checks: [], loading: false, detected: false };
  }
}

export function useDoctorStatus() {
  const [state, setState] = useState<DoctorState>(
    cachedState ?? { checks: [], loading: true, detected: false },
  );

  useEffect(() => {
    let active = true;
    doctorRequest ??= loadDoctorState().then((result) => {
      cachedState = result;
      return result;
    });
    void doctorRequest.then((result) => {
      if (active) setState(result);
    });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
