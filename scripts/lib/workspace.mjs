import { constants } from 'node:fs';
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// 工作目录初始化：建数据目录 + 个人文件模板（幂等，已存在则跳过）。
// 供 scripts/setup.mjs 与 scripts/init-workspace.mjs 复用，也可被 Agent 直接调用。

const DIRS = [
  'data',
  'reports',
  'output',
  'interview-prep',
  'jds',
  'batch/logs',
  'batch/tracker-additions',
];

// [来源模板, 目标文件]；来源相对仓库根，目标相对工作目录。
const COPY_FILES = [
  ['config/profile.example.yml', 'config/profile.yml'],
  ['modes/_profile.template.md', 'modes/_profile.md'],
  ['templates/portals.example.yml', 'portals.yml'],
];

const TOUCH_FILES = [
  ['cv.md', '# 我的简历\n\n请在这里填写你的简历。\n'],
  ['article-digest.md', '# 项目亮点\n\n请在这里记录你的项目、文章、作品亮点。\n'],
];

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 在 workspaceRoot 建好数据目录和个人文件模板。
 * @param {object} opts
 * @param {string} opts.workspaceRoot 工作目录（数据写这里）
 * @param {string} opts.repoRoot 仓库根（模板从这里拷）
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{created: string[], skipped: string[]}>}
 */
export async function ensureWorkspace({ workspaceRoot, repoRoot, log = () => {} }) {
  const created = [];
  const skipped = [];

  for (const dir of DIRS) {
    await mkdir(resolve(workspaceRoot, dir), { recursive: true });
  }

  for (const [from, to] of COPY_FILES) {
    const target = resolve(workspaceRoot, to);
    if (await exists(target)) { skipped.push(to); log(`[OK] 已存在 ${to}`); continue; }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(repoRoot, from), target);
    created.push(to);
    log(`[OK] 已创建 ${to}`);
  }

  for (const [to, content] of TOUCH_FILES) {
    const target = resolve(workspaceRoot, to);
    if (await exists(target)) { skipped.push(to); log(`[OK] 已存在 ${to}`); continue; }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    created.push(to);
    log(`[OK] 已创建 ${to}`);
  }

  return { created, skipped };
}
