import { readFile } from 'node:fs/promises';

import { parseFailure, parseFivePointScore } from './shared.mjs';

const CHECKBOX_LINE = /^-\s*\[([ xX])\]\s*(.*)$/;

export function inferPlatform(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'zhipin.com' || hostname.endsWith('.zhipin.com')) return 'BOSS';
    if (hostname === 'liepin.com' || hostname.endsWith('.liepin.com')) return '猎聘';
    if (hostname === 'zhaopin.com' || hostname.endsWith('.zhaopin.com')) return '智联';
    if (hostname === '51job.com' || hostname.endsWith('.51job.com')) return '前程无忧';
  } catch {
    return '其他';
  }
  return '其他';
}

export function parsePipeline(content) {
  const results = [];

  String(content).split(/\r?\n/).forEach((raw, index) => {
    const match = raw.trim().match(CHECKBOX_LINE);
    if (!match) return;

    const processed = match[1].toLowerCase() === 'x';
    const fields = match[2].split('|').map((field) => field.trim());
    const url = fields[0] ?? '';

    // Expect at least 10 fields: URL, company, role, salary, city, experience, education, industry, companySize, score
    // Role field may contain '|' (e.g. "交付效能工程师|工具化与AI赋能交付"), so when there are
    // extra fields we merge the surplus into role rather than rejecting the line.
    if (fields.length < 10 || !url) {
      results.push(parseFailure(raw, index + 1, { url }));
      return;
    }

    const scorePart = fields[fields.length - 1];
    const score = parseFivePointScore(scorePart.replace(/^初筛分\s*:\s*/, ''), { minimum: 0 });
    if (score === undefined) {
      results.push(parseFailure(raw, index + 1, { url }));
      return;
    }

    const tail = fields.slice(-7);
    const parsedUrl = fields[0];
    const company = fields[1];
    const role = fields.slice(2, fields.length - 7).join(' | ');
    const [salary, city, experience, education, industry, companySize] = tail;
    results.push({
      ok: true,
      url: parsedUrl,
      company,
      role,
      salary,
      city,
      experience,
      education,
      industry,
      companySize,
      preFilterScore: score,
      platform: inferPlatform(parsedUrl),
      processed,
    });
  });

  return results;
}

export async function parsePipelineFile(filePath) {
  try {
    return parsePipeline(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
