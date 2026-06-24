#!/usr/bin/env node
/**
 * 多平台城市码查询工具
 *
 * 数据来源：
 *   51job   — https://js.51jobcdn.com/in/js/2016/layer/area_array_c.js（GBK，3367城市）
 *   zhaopin — https://fe-api.zhaopin.com/c/i/city（487城市）
 *   boss    — https://www.zhipin.com/wapi/zpCommon/data/city.json（374城市）
 *   liepin  — https://www.liepin.com/citylist/ 及各城市页面中的 dqCode
 *
 * 用法（ESM）：
 *   import { getCity, listCities, PLATFORMS } from '../shared/city-codes.mjs';
 *   getCity('boss', '佛山')     // → '101280800'
 *   getCity('zhaopin', '广州')  // → '763'
 *   getCity('51job', '深圳')    // → '040000'
 *   listCities('boss')          // → [{ name, code }, ...]
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, 'city-codes.json');

let _data = null;
function getData() {
  if (!_data) _data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  return _data;
}

/** 支持的平台标识 */
export const PLATFORMS = ['51job', 'zhaopin', 'boss', 'liepin'];

/**
 * 根据城市名称查询对应平台的城市码。
 * @param {'51job'|'zhaopin'|'boss'|'liepin'} platform  平台标识
 * @param {string} cityName                     城市名（如 '佛山'）
 * @returns {string|null}                       城市码字符串，未找到返回 null
 */
export function getCity(platform, cityName) {
  const map = getData()[platform];
  if (!map) throw new Error(`Unknown platform: ${platform}. Valid: ${PLATFORMS.join(', ')}`);
  return map[cityName] ?? null;
}

/**
 * 列出指定平台的所有城市。
 * @param {'51job'|'zhaopin'|'boss'|'liepin'} platform
 * @returns {{ name: string, code: string }[]}
 */
export function listCities(platform) {
  const map = getData()[platform];
  if (!map) throw new Error(`Unknown platform: ${platform}. Valid: ${PLATFORMS.join(', ')}`);
  return Object.entries(map)
    .filter(([name]) => !name.startsWith('_'))
    .map(([name, code]) => ({ name, code }));
}

/**
 * 模糊搜索城市（包含匹配）。
 * @param {'51job'|'zhaopin'|'boss'|'liepin'} platform
 * @param {string} query  搜索关键词
 * @returns {{ name: string, code: string }[]}
 */
export function searchCity(platform, query) {
  return listCities(platform).filter(c => c.name.includes(query));
}

/**
 * 跨平台查询：返回某城市在所有平台的城市码（找不到显示 null）。
 * @param {string} cityName
 * @returns {{ '51job': string|null, zhaopin: string|null, boss: string|null, liepin: string|null }}
 */
export function getCityAllPlatforms(cityName) {
  return Object.fromEntries(PLATFORMS.map(p => [p, getCity(p, cityName)]));
}

// ── CLI entry point ────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  if (cmd === 'get') {
    // node city-codes.mjs get <platform> <cityName>
    const [, platform, cityName] = args;
    if (!platform || !cityName) {
      console.error('Usage: node city-codes.mjs get <platform> <cityName>');
      process.exit(1);
    }
    const code = getCity(platform, cityName);
    if (code) { console.log(code); }
    else { console.error(`City not found: ${cityName} on ${platform}`); process.exit(1); }

  } else if (cmd === 'all') {
    // node city-codes.mjs all <cityName>
    const cityName = args[1];
    if (!cityName) { console.error('Usage: node city-codes.mjs all <cityName>'); process.exit(1); }
    const result = getCityAllPlatforms(cityName);
    console.log(JSON.stringify(result, null, 2));

  } else if (cmd === 'search') {
    // node city-codes.mjs search <platform> <query>
    const [, platform, query] = args;
    if (!platform || !query) {
      console.error('Usage: node city-codes.mjs search <platform> <query>');
      process.exit(1);
    }
    const results = searchCity(platform, query);
    console.log(JSON.stringify(results.slice(0, 20), null, 2));

  } else if (cmd === 'list') {
    // node city-codes.mjs list <platform>
    const platform = args[1];
    if (!platform) { console.error('Usage: node city-codes.mjs list <platform>'); process.exit(1); }
    const cities = listCities(platform);
    console.log(`${platform}: ${cities.length} cities`);
    cities.slice(0, 10).forEach(c => console.log(`  ${c.name} = ${c.code}`));
    if (cities.length > 10) console.log(`  ... (${cities.length - 10} more)`);

  } else {
    console.log(`城市码查询工具

用法：
  node city-codes.mjs get <platform> <cityName>   查询城市码
  node city-codes.mjs all <cityName>               跨平台查询
  node city-codes.mjs search <platform> <query>   模糊搜索
  node city-codes.mjs list <platform>             列出城市（前10条）

平台：51job | zhaopin | boss | liepin

示例：
  node city-codes.mjs get boss 佛山
  node city-codes.mjs get liepin 佛山
  node city-codes.mjs all 广州
  node city-codes.mjs search 51job 苏
`);
  }
}
