import type { ScanHistoryEntry } from '../types';
import type { ParseFailure } from './shared';
import { parseFailure } from './shared';

const VALID_STATUSES = new Set(['added', 'skipped_dup', 'skipped_title']);

export function parseScanHistory(content: string): Array<ScanHistoryEntry | ParseFailure> {
  const results: Array<ScanHistoryEntry | ParseFailure> = [];

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
