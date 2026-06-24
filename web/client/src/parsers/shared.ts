export interface ParseFailure {
  ok: false;
  raw: string;
  line: number;
  url?: string;
}

export function parseFailure(raw: string, line: number, extra: Record<string, unknown> = {}): ParseFailure {
  return { ok: false, raw, line, ...extra } as ParseFailure;
}

export function splitMarkdownRow(raw: string): string[] {
  const normalized = raw.replaceAll('｜', '|').trim();
  const withoutEdges = normalized.replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map((value) => value.trim());
}

export function parseFivePointScore(
  value: unknown,
  { nullable = false, minimum = 0 } = {},
): number | null | undefined {
  const raw = String(value ?? '').trim();
  if (nullable && /^N\/A$/i.test(raw)) return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*5$/);
  if (!match) return undefined;
  const score = Number(match[1]);
  return score >= minimum && score <= 5 ? score : undefined;
}
