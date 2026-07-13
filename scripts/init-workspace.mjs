#!/usr/bin/env node
/**
 * init-workspace.mjs — 建立职程工作目录（数据目录 + 个人文件模板），不装依赖、不启动服务。
 *
 * 给 Agent 直接调用："先确保工作目录就绪，再采集/评估"。也可人工运行。
 *
 * 用法:
 *   node scripts/init-workspace.mjs            # 在项目根建立工作目录
 *   node scripts/init-workspace.mjs <目录>     # 在指定目录建立工作目录
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureWorkspace } from './lib/workspace.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : repoRoot;

const { created, skipped } = await ensureWorkspace({
  workspaceRoot: target,
  repoRoot,
  log: (msg) => console.log(msg),
});

console.log(`\n工作目录就绪：${target}`);
console.log(`  新建 ${created.length} 个，已存在 ${skipped.length} 个。`);
if (created.some((f) => ['cv.md', 'config/profile.yml', 'modes/_profile.md'].includes(f))) {
  console.log('  提示：cv.md / config/profile.yml / modes/_profile.md 目前是模板，评估前请填好。');
}
