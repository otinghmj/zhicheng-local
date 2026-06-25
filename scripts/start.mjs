#!/usr/bin/env node

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const devMode = args.has('--dev');
const noOpen = args.has('--no-open');
const children = [];

async function exists(path) {
  try {
    await access(resolve(root, path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function run(name, command, commandArgs, cwd) {
  const child = spawn(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] 已退出，退出码 ${code}`);
      shutdown(code);
    }
  });
}

function openBrowser(url) {
  if (noOpen) return;
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  const commandArgs = process.platform === 'win32' ? ['', url] : [url];
  spawn(command, commandArgs, {
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  }).unref();
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

async function main() {
  for (const path of ['web/server/node_modules', 'web/client/node_modules']) {
    if (!await exists(path)) {
      console.error(`缺少依赖目录：${path}`);
      console.error('请先运行：npm run setup');
      process.exit(1);
    }
  }

  console.log('正在启动职程本地版...');
  console.log('后端：http://127.0.0.1:3200');
  console.log('前端：http://localhost:5173');
  console.log('按 Ctrl+C 退出。\n');

  run('server', 'npm', ['run', devMode ? 'dev' : 'start'], resolve(root, 'web/server'));
  run('client', 'npm', ['run', 'dev'], resolve(root, 'web/client'));

  setTimeout(() => openBrowser('http://localhost:5173'), 1800);

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

main().catch((error) => {
  console.error(`启动失败：${error.message}`);
  process.exit(1);
});
