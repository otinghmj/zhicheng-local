import { describe, it, expect } from 'vitest';
import { parseScanHistory } from '../scan-history';
import type { ScanHistoryEntry } from '../../types';

describe('parseScanHistory', () => {
  it('parses valid TSV entries', () => {
    const content = [
      'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
      'https://example.com/1\t2026-06-01\tboss\tBackend\tAcme\tadded',
      'https://example.com/2\t2026-06-02\tliepin\tFrontend\tBeta\tskipped_dup',
    ].join('\n');

    const results = parseScanHistory(content);
    expect(results).toHaveLength(2);
    const first = results[0] as ScanHistoryEntry;
    expect(first.url).toBe('https://example.com/1');
    expect(first.portal).toBe('boss');
    expect(first.status).toBe('added');
  });

  it('skips header row', () => {
    const content = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';
    expect(parseScanHistory(content)).toHaveLength(0);
  });

  it('returns parse failure for wrong column count', () => {
    const content = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://example.com\t2026-06-01';
    const results = parseScanHistory(content);
    expect(results[0]).toHaveProperty('ok', false);
  });

  it('returns parse failure for invalid status', () => {
    const content = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\nhttps://example.com\t2026-06-01\tboss\tTitle\tCompany\tinvalid_status';
    const results = parseScanHistory(content);
    expect(results[0]).toHaveProperty('ok', false);
  });

  it('handles empty content', () => {
    expect(parseScanHistory('')).toHaveLength(0);
  });

  it('handles skipped_title status', () => {
    const content = 'https://example.com\t2026-06-01\tboss\tTitle\tCompany\tskipped_title';
    const results = parseScanHistory(content);
    expect((results[0] as ScanHistoryEntry).status).toBe('skipped_title');
  });
});
