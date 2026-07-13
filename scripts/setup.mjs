#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureWorkspace } from './lib/workspace.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const skipInstall = args.has('--skip-install');
const skipPlaywright = args.has('--skip-playwright');

function log(message) {
  console.log(message);
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolvePromise, reject) => {
    log(`\n$ ${[command, ...commandArgs].join(' ')}`);
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${commandArgs.join(' ')} 退出码 ${code}`));
    });
  });
}

async function main() {
  log('开始初始化职程本地版...\n');

  await ensureWorkspace({ workspaceRoot: root, repoRoot: root, log });

  if (!skipInstall) {
    await run('npm', ['install']);
    await run('npm', ['install'], { cwd: resolve(root, 'web/server') });
    await run('npm', ['install'], { cwd: resolve(root, 'web/client') });
  }

  if (!skipPlaywright) {
    // Playwright Chromium 仅用于 PDF 生成，下载失败不应中断整个初始化（前后端依赖此时已装好）。
    try {
      await run('npx', ['playwright', 'install', 'chromium']);
    } catch (error) {
      log(`\n[WARN] Playwright Chromium 安装失败：${error.message}`);
      log('[WARN] 这只影响 PDF 生成（npm run pdf）。前后端已就绪，可正常启动。');
      log('[WARN] 需要 PDF 时可稍后重试：npx playwright install chromium');
    }
  }

  log('\n初始化完成。下一步：');
  log('  npm run doctor');
  log('  npm start');
}

main().catch((error) => {
  console.error(`\n初始化失败：${error.message}`);
  process.exit(1);
});
