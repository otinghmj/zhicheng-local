export function parseSalary(value) {
  const text = String(value ?? '').trim();
  const months = Number(text.match(/[·x×*]\s*(\d+(?:\.\d+)?)\s*薪/i)?.[1] ?? 12);
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-~至]\s*(\d+(?:\.\d+)?)\s*(万|[kK])/);
  if (!range) return { min: null, max: null, months };

  const multiplier = range[3].toLowerCase() === 'k' ? 1_000 : 10_000;
  return {
    min: Number(range[1]) * multiplier,
    max: Number(range[2]) * multiplier,
    months,
  };
}
