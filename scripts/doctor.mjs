#!/usr/bin/env node

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let warnings = 0;

async function exists(path) {
  try {
    await access(resolve(root, path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ok(message) {
  console.log(`[OK] ${message}`);
}

function warn(message) {
  warnings += 1;
  console.log(`[WARN] ${message}`);
}

function fail(message) {
  failures += 1;
  console.log(`[FAIL] ${message}`);
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

function checkPort(port) {
  return new Promise((resolvePromise) => {
    const server = net.createServer();
    server.once('error', () => resolvePromise(false));
    server.once('listening', () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function chromeCandidates() {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
  }
  if (process.platform === 'win32') {
    return [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ].filter(Boolean);
  }
  return ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium'];
}

async function checkChrome() {
  if (process.platform === 'linux') {
    for (const command of chromeCandidates()) {
      if (spawnSync('which', [command], { encoding: 'utf8' }).status === 0) {
        ok(`已找到 Chrome/Chromium：${command}`);
        return;
      }
    }
    warn('未找到 Chrome/Chromium。采集功能需要本机浏览器登录态。');
    return;
  }

  for (const path of chromeCandidates()) {
    try {
      await access(path, constants.F_OK);
      ok(`已找到 Chrome：${path}`);
      return;
    } catch {}
  }
  warn('未找到 Google Chrome。采集功能需要本机 Chrome。');
}

async function main() {
  console.log('职程环境检查\n');

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) ok(`Node.js ${process.version}`);
  else fail(`Node.js 版本过低：${process.version}，需要 18 或更高版本`);

  if (commandExists('npm')) ok('npm 可用');
  else fail('npm 不可用，请先安装 Node.js');

  for (const path of ['node_modules', 'web/server/node_modules', 'web/client/node_modules']) {
    if (await exists(path)) ok(`依赖目录存在：${path}`);
    else warn(`依赖目录缺失：${path}，请运行 npm run setup`);
  }

  for (const path of ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml']) {
    if (await exists(path)) ok(`个人配置存在：${path}`);
    else warn(`个人配置缺失：${path}，请运行 npm run setup 后填写`);
  }

  for (const dir of ['data', 'reports', 'output', 'interview-prep']) {
    if (await exists(dir)) ok(`数据目录存在：${dir}`);
    else warn(`数据目录缺失：${dir}`);
  }

  await checkChrome();

  for (const port of [3200, 5173]) {
    if (await checkPort(port)) ok(`端口 ${port} 当前可用`);
    else warn(`端口 ${port} 已被占用。如果服务已启动，可忽略；否则请关闭占用程序。`);
  }

  console.log(`\n检查完成：${failures} 个失败，${warnings} 个提醒。`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`检查失败：${error.message}`);
  process.exit(1);
});
