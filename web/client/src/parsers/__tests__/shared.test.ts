import { describe, it, expect } from 'vitest';
import { splitMarkdownRow, parseFivePointScore, parseFailure } from '../shared';

describe('splitMarkdownRow', () => {
  it('splits a standard markdown row', () => {
    expect(splitMarkdownRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
  });

  it('handles rows without leading/trailing pipes', () => {
    expect(splitMarkdownRow('a | b | c')).toEqual(['a', 'b', 'c']);
  });

  it('normalizes full-width pipes', () => {
    expect(splitMarkdownRow('| a ｜ b | c |')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace', () => {
    expect(splitMarkdownRow('|  hello  |  world  |')).toEqual(['hello', 'world']);
  });
});

describe('parseFivePointScore', () => {
  it('parses valid score', () => {
    expect(parseFivePointScore('4.2/5')).toBe(4.2);
  });

  it('parses score with spaces', () => {
    expect(parseFivePointScore('3.5 / 5')).toBe(3.5);
  });

  it('returns undefined for invalid score', () => {
    expect(parseFivePointScore('abc')).toBeUndefined();
  });

  it('returns undefined for score > 5', () => {
    expect(parseFivePointScore('6.0/5')).toBeUndefined();
  });

  it('returns null for N/A when nullable', () => {
    expect(parseFivePointScore('N/A', { nullable: true })).toBeNull();
  });

  it('returns undefined for N/A when not nullable', () => {
    expect(parseFivePointScore('N/A')).toBeUndefined();
  });

  it('enforces minimum', () => {
    expect(parseFivePointScore('0.5/5', { minimum: 1 })).toBeUndefined();
    expect(parseFivePointScore('1.0/5', { minimum: 1 })).toBe(1.0);
  });

  it('handles integer scores', () => {
    expect(parseFivePointScore('5/5')).toBe(5);
  });
});

describe('parseFailure', () => {
  it('creates a parse failure object', () => {
    const result = parseFailure('bad line', 5);
    expect(result).toEqual({ ok: false, raw: 'bad line', line: 5 });
  });

  it('includes extra fields', () => {
    const result = parseFailure('bad', 1, { url: 'http://test.com' });
    expect(result.url).toBe('http://test.com');
  });
});
