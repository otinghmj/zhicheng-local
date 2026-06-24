import { readFile } from 'node:fs/promises';

import { parseFailure } from './shared.mjs';

const VALID_STATUSES = new Set(['added', 'skipped_dup', 'skipped_title']);

export function parseScanHistory(content) {
  const results = [];

  String(content).split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const fields = raw.split('\t');
    if (index === 0 && fields.join('\t') === 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus') return;
    if (fields.length !== 6 || !VALID_STATUSES.has(fields[5])) {
      results.push(parseFailure(raw, index + 1));
      return;
    }
    const [url, firstSeen, portal, title, company, status] = fields;
    results.push({ url, firstSeen, portal, title, company, status });
  });

  return results;
}

export async function parseScanHistoryFile(filePath) {
  try {
    return parseScanHistory(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
