#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const rest = args.slice(1);

const commands = {
  setup: ['scripts/setup.mjs'],
  doctor: ['scripts/doctor.mjs'],
  start: ['scripts/start.mjs'],
  dev: ['scripts/start.mjs', '--dev'],
  'mcp:setup': ['web/server/setup-mcp.mjs'],
  'mcp:print': ['web/server/setup-mcp.mjs', '--print'],
};

function printHelp() {
  console.log(`
职程命令行

用法：
  zhicheng setup      安装依赖并初始化本地文件
  zhicheng doctor     检查运行环境
  zhicheng start      启动本地 Web
  zhicheng dev        以开发模式启动
  zhicheng mcp:setup  为 Claude Code / Cursor 写入 MCP 配置
  zhicheng mcp:print  打印任意 Agent 可用的 MCP 配置

如果你还没有全局安装，也可以在项目目录运行：
  npx . setup
  npx . start
`);
}

if (command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

const target = commands[command];
if (!target) {
  console.error(`未知命令：${command}`);
  printHelp();
  process.exit(1);
}

const child = spawn(process.execPath, [...target, ...rest], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
