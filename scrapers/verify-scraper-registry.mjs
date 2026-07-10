#!/usr/bin/env node
/**
 * 采集脚本注册表一致性检查
 *
 * 以 scrapers/registry.json 为唯一真值，检查所有文档文件是否同步引用了
 * 各平台当前的主采集脚本。任何不一致均以非零退出码报错。
 *
 * 用法：
 *   node scrapers/verify-scraper-registry.mjs
 *   node scrapers/verify-scraper-registry.mjs --fix   # （仅提示，不自动修改）
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOME = process.env.HOME || process.env.USERPROFILE || "";

const RED   = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW= "\x1b[33m";
const BOLD  = "\x1b[1m";
const RESET = "\x1b[0m";

function resolvePath(p) {
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  return path.join(ROOT, p);
}

async function readText(p) {
  return fs.readFile(resolvePath(p), "utf8");
}

async function fileExists(p) {
  try { await fs.access(resolvePath(p)); return true; }
  catch { return false; }
}

// 检查文件内容是否包含 scriptBasename（不区分路径前缀，只看文件名）
function contains(content, scriptBasename) {
  return content.includes(scriptBasename);
}

async function main() {
  const registry = JSON.parse(await readText("scrapers/registry.json"));
  const { platforms, docFiles } = registry;

  let errors = 0;
  let warnings = 0;

  console.log(`${BOLD}采集脚本注册表一致性检查${RESET}`);
  console.log("=".repeat(60));

  // 读取所有文档文件（一次性，避免重复 IO）
  const docs = {};
  const missingDocs = new Set(); // 缺失的文档 key——分发场景下项目级文档可不存在，降级为警告
  for (const [key, relPath] of Object.entries(docFiles)) {
    if (key === "skillRefsDir") continue;
    try {
      docs[key] = await readText(relPath);
    } catch {
      console.log(`${YELLOW}⚠  文档文件不存在，跳过: ${relPath}${RESET}`);
      warnings++;
      docs[key] = "";
      missingDocs.add(key);
    }
  }

  for (const [platform, cfg] of Object.entries(platforms)) {
    console.log(`\n${BOLD}[${platform}]${RESET}  mainScript: ${cfg.mainScript}  mode: ${cfg.mode}`);

    const scriptBasename = path.basename(cfg.mainScript);
    let platformOk = true;

    // 1. 主脚本文件本身是否存在
    if (!await fileExists(cfg.mainScript)) {
      console.log(`  ${RED}✗ 脚本文件不存在: ${cfg.mainScript}${RESET}`);
      errors++; platformOk = false;
    } else {
      console.log(`  ${GREEN}✓ 脚本文件存在${RESET}`);
    }

    // 2. 平台自己的 README.md
    const platformReadmePath = `scrapers/${platform}/README.md`;
    if (!await fileExists(platformReadmePath)) {
      console.log(`  ${YELLOW}⚠  无 README: ${platformReadmePath}${RESET}`);
      warnings++;
    } else {
      const content = await readText(platformReadmePath);
      if (!contains(content, scriptBasename)) {
        console.log(`  ${RED}✗ ${platformReadmePath} 未引用 ${scriptBasename}${RESET}`);
        errors++; platformOk = false;
      } else {
        console.log(`  ${GREEN}✓ scrapers/${platform}/README.md${RESET}`);
      }
    }

    // 3. scrapers/shared/README.md
    if (!contains(docs.sharedReadme, scriptBasename)) {
      console.log(`  ${RED}✗ scrapers/shared/README.md 未引用 ${scriptBasename}${RESET}`);
      errors++; platformOk = false;
    } else {
      console.log(`  ${GREEN}✓ scrapers/shared/README.md${RESET}`);
    }

    // 4. 项目说明/核心文件索引.md（项目级文档，分发场景可缺失→已在加载阶段警告，跳过检查）
    if (!missingDocs.has("coreIndex")) {
      if (!contains(docs.coreIndex, scriptBasename)) {
        console.log(`  ${RED}✗ 项目说明/核心文件索引.md 未引用 ${scriptBasename}${RESET}`);
        errors++; platformOk = false;
      } else {
        console.log(`  ${GREEN}✓ 项目说明/核心文件索引.md${RESET}`);
      }
    }

    // 5. 项目说明/目录结构.md（同上，项目级文档，缺失时降级跳过）
    if (!missingDocs.has("dirStructure")) {
      if (!contains(docs.dirStructure, scriptBasename)) {
        console.log(`  ${RED}✗ 项目说明/目录结构.md 未引用 ${scriptBasename}${RESET}`);
        errors++; platformOk = false;
      } else {
        console.log(`  ${GREEN}✓ 项目说明/目录结构.md${RESET}`);
      }
    }

    // 6. skill references/{platform}.md
    if (cfg.skillRef) {
      const skillRefPath = docFiles.skillRefsDir + cfg.skillRef;
      if (!await fileExists(skillRefPath)) {
        console.log(`  ${YELLOW}⚠  skill 参考文件不存在: ${skillRefPath}${RESET}`);
        warnings++;
      } else {
        const content = await readText(skillRefPath);
        if (!contains(content, scriptBasename)) {
          console.log(`  ${RED}✗ ${skillRefPath} 未引用 ${scriptBasename}${RESET}`);
          errors++; platformOk = false;
        } else {
          console.log(`  ${GREEN}✓ skill/${cfg.skillRef}${RESET}`);
        }
      }
    }

    // 7. SKILL.md 能力表 mode 列（宽松检查：mode 字符串出现在 SKILL.md 里即可）
    if (!contains(docs.skillBase, cfg.mode)) {
      console.log(`  ${YELLOW}⚠  SKILL.md 能力表未找到 mode="${cfg.mode}"（需手动核对）${RESET}`);
      warnings++;
    } else {
      console.log(`  ${GREEN}✓ SKILL.md 含 mode "${cfg.mode}"${RESET}`);
    }

    if (platformOk) {
      console.log(`  → ${GREEN}全部通过${RESET}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  if (errors === 0 && warnings === 0) {
    console.log(`${GREEN}${BOLD}✅ 全部通过，无错误，无警告${RESET}`);
  } else if (errors === 0) {
    console.log(`${YELLOW}${BOLD}⚠  通过（${warnings} 个警告）${RESET}`);
  } else {
    console.log(`${RED}${BOLD}✗ ${errors} 个错误，${warnings} 个警告${RESET}`);
    console.log(`\n修复方法：`);
    console.log(`  1. 在 scrapers/registry.json 更新 mainScript 为正确路径`);
    console.log(`  2. 按错误提示逐个更新对应文档文件`);
    console.log(`  3. 重新运行此脚本直至全部通过`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`脚本错误: ${err.message}`);
  process.exit(1);
});
