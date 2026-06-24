import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseScanHistory } from '../src/parsers/scanHistory.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/scan-history.tsv', import.meta.url));

describe('parseScanHistory', () => {
  it('解析 6 列 TSV，并允许空公司', async () => {
    const result = parseScanHistory(await readFile(fixturePath, 'utf8'));
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ company: '', status: 'skipped_title' });
  });
  it('残缺行返回统一降级结构', () => {
    expect(parseScanHistory('url\tfirst_seen\tportal\ttitle\tcompany\tstatus\na\tb')[0]).toMatchObject({ ok: false, line: 2 });
  });
});
