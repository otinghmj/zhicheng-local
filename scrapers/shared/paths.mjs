// 统一路径解析（B 类通用化改造）
//
// 目标：
//   B2 — 以脚本自身位置定位项目根，不依赖用户敲命令时所在的目录（CWD）
//   B1 — 输出根目录可通过环境变量 SCRAPER_OUTPUT_DIR 覆盖
//   B3 — pipeline 写入路径可通过环境变量 SCRAPER_PIPELINE_PATH 覆盖
//
// 用法：
//   import { outPath, PIPELINE_PATH, PROJECT_ROOT, OUTPUT_DIR } from "../shared/paths.mjs";
//   const outDir = outPath("boss/cdp", query, city);   // = <OUTPUT_DIR>/boss/cdp/<query>/<city>

import path from "node:path";
import fs   from "node:fs";
import { fileURLToPath } from "node:url";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url)); // scrapers/shared

// 从本文件位置向上回溯，找到含 scrapers/shared/city-codes.json 的目录 = 项目根
function findProjectRoot() {
  let dir = SELF_DIR;
  while (true) {
    if (fs.existsSync(path.join(dir, "scrapers", "shared", "city-codes.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 兜底：paths.mjs 固定在 scrapers/shared/ 下，项目根即上两级
  return path.resolve(SELF_DIR, "..", "..");
}

export const PROJECT_ROOT = findProjectRoot();

// 输出根目录：优先 env SCRAPER_OUTPUT_DIR，否则项目根下的 output/
export const OUTPUT_DIR = process.env.SCRAPER_OUTPUT_DIR
  ? path.resolve(process.env.SCRAPER_OUTPUT_DIR)
  : path.join(PROJECT_ROOT, "output");

// pipeline 写入路径：优先 env SCRAPER_PIPELINE_PATH，否则项目根下的 data/pipeline.md
export const PIPELINE_PATH = process.env.SCRAPER_PIPELINE_PATH
  ? path.resolve(process.env.SCRAPER_PIPELINE_PATH)
  : path.join(PROJECT_ROOT, "data", "pipeline.md");

// 拼接输出路径：outPath("boss/cdp", q, city) → <OUTPUT_DIR>/boss/cdp/q/city
export function outPath(...segments) {
  return path.join(OUTPUT_DIR, ...segments);
}
