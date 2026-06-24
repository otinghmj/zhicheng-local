#!/usr/bin/env node

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'city-codes.json');
const CITY_LIST_URL = 'https://www.liepin.com/citylist/';
const CONCURRENCY = 3;
const USER_AGENT = '';
const execFileAsync = promisify(execFile);

async function fetchHtml(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const { stdout } = await execFileAsync('curl', [
        '--fail',
        '--location',
        '--compressed',
        '--silent',
        '--show-error',
        '--max-time', '30',
        '--user-agent', USER_AGENT,
        url,
      ], { maxBuffer: 2 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      if (attempt === retries) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error(`Failed to fetch ${url}`);
}

function parseCityLinks(html) {
  const links = [];
  const seen = new Set();
  const pattern = /href="(https:\/\/www\.liepin\.com\/city-[^"]+\/)"[^>]*>([^<]+)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const [, url, name] = match;
    if (seen.has(url)) continue;
    seen.add(url);
    links.push({ name: name.trim(), url });
  }
  return links;
}

function parseCityCode(html, fallbackName) {
  const code = html.match(/["']?dqCode["']?\s*:\s*'(\d+)'/)?.[1];
  const name = html.match(/["']?adDqName["']?\s*:\s*'([^']+)'/)?.[1]?.trim() || fallbackName;
  if (!code) throw new Error(`Missing dqCode for ${fallbackName}`);
  return { name, code };
}

async function fetchCity({ name, url }, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return parseCityCode(await fetchHtml(url), name);
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 800));
    }
  }
  throw new Error(`Failed to parse ${name}`);
}

async function mapConcurrent(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  return results;
}

const listHtml = process.env.LIEPIN_CITY_LIST_HTML
  ? await fs.readFile(path.resolve(process.env.LIEPIN_CITY_LIST_HTML), 'utf8')
  : await fetchHtml(CITY_LIST_URL);
const links = parseCityLinks(listHtml);
if (links.length < 250) throw new Error(`Official city list is unexpectedly short: ${links.length}`);

const cities = await mapConcurrent(links, async ({ name, url }, index) => {
  const city = await fetchCity({ name, url });
  process.stderr.write(`\r猎聘城市代码：${index + 1}/${links.length}`);
  return city;
});
process.stderr.write('\n');

const uniqueCities = Object.fromEntries(cities.map(({ name, code }) => [name, code]));
const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
data.liepin = {
  _说明: '来源：www.liepin.com/citylist/ 及各城市官方页面中的 dqCode；用于候选人侧 /zhaopin/ 的 dq 参数。',
  全国: '410',
  ...uniqueCities,
};

await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
console.log(`已写入 ${Object.keys(uniqueCities).length} 个猎聘城市代码。`);
