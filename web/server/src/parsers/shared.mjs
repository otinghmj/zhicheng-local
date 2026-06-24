export function parseFailure(raw, line, extra = {}) {
  return { ok: false, raw, line, ...extra };
}

export function splitMarkdownRow(raw) {
  const normalized = raw.replaceAll('｜', '|').trim();
  const withoutEdges = normalized.replace(/^\|/, '').replace(/\|$/, '');
  return withoutEdges.split('|').map((value) => value.trim());
}

export function parseFivePointScore(value, { nullable = false, minimum = 0 } = {}) {
  const raw = String(value ?? '').trim();
  if (nullable && /^N\/A$/i.test(raw)) return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*5$/);
  if (!match) return undefined;
  const score = Number(match[1]);
  return score >= minimum && score <= 5 ? score : undefined;
}
