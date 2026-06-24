#!/usr/bin/env node
/**
 * OpenCLI 环境检查脚本
 * 运行前先执行此脚本确认一切就绪
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(cmd, args = []) {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 10000 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { ok: false, error: err.message, stdout: err.stdout?.trim(), stderr: err.stderr?.trim() };
  }
}

console.log("=== OpenCLI 环境检查 ===\n");

// 1. Node 版本
const node = await run("node", ["--version"]);
const nodeVersion = node.stdout?.replace("v", "").split(".")[0];
const nodeOk = Number(nodeVersion) >= 20;
console.log(`[${nodeOk ? "✅" : "❌"}] Node.js: ${node.stdout} (需要 >=20)`);

// 2. opencli 是否安装
const which = await run("which", ["opencli"]);
console.log(`[${which.ok ? "✅" : "❌"}] opencli 命令: ${which.ok ? which.stdout : "未找到 — 运行 npm install -g @jackwener/opencli"}`);

if (!which.ok) {
  console.log("\n⚠️  OpenCLI 未安装，请先运行：");
  console.log("   npm install -g @jackwener/opencli\n");
  console.log("安装后需要：");
  console.log("1. 打开 Chrome，安装 OpenCLI Browser Bridge 扩展");
  console.log("2. 运行 opencli doctor 验证连接");
  process.exit(1);
}

// 3. opencli 版本
const version = await run("opencli", ["--version"]);
console.log(`[${version.ok ? "✅" : "⚠️"}] opencli 版本: ${version.ok ? version.stdout : "未知"}`);

// 4. opencli doctor
console.log("\n--- opencli doctor ---");
const doctor = await run("opencli", ["doctor"]);
if (doctor.ok) {
  console.log(doctor.stdout);
} else {
  console.log("doctor 输出:", doctor.stdout || doctor.stderr);
}

// 5. 检查 boss 命令是否可用
console.log("\n--- 检查平台适配器 ---");
const bossList = await run("opencli", ["boss", "--help"]);
console.log(`[${bossList.ok ? "✅" : "❌"}] boss 适配器: ${bossList.ok ? "可用" : bossList.stderr?.slice(0, 100)}`);

const job51List = await run("opencli", ["51job", "--help"]);
console.log(`[${job51List.ok ? "✅" : "❌"}] 51job 适配器: ${job51List.ok ? "可用" : job51List.stderr?.slice(0, 100)}`);

console.log("\n=== 检查完成 ===");
console.log("如果 Browser Bridge 未连接，在 Chrome 中点击 OpenCLI 扩展图标激活连接。");
