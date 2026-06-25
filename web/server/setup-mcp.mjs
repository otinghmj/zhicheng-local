#!/usr/bin/env node
/**
 * 一键配置 AI Agent 连接职程 MCP Server
 *
 * 用法:
 *   node setup-mcp.mjs                  # 自动检测 Agent 类型
 *   node setup-mcp.mjs --agent claude    # Claude Code
 *   node setup-mcp.mjs --agent cursor    # Cursor
 *   node setup-mcp.mjs --port 3200       # 自定义端口
 *   node setup-mcp.mjs --remove          # 移除配置
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const param = (name) => { const i = args.indexOf(`--${name}`); return i !== -1 && args[i + 1] ? args[i + 1] : null; };

const port = param('port') || process.env.SERVER_PORT || '3200';
const mcpUrl = `http://localhost:${port}/mcp`;
const remove = flag('remove');
const serverName = 'zhicheng';
const legacyServerName = 'zhicheng';

const AGENTS = {
  claude: {
    name: 'Claude Code',
    configPath: join(homedir(), '.claude', 'settings.json'),
    configDir: join(homedir(), '.claude'),
  },
  cursor: {
    name: 'Cursor',
    configPath: join(homedir(), '.cursor', 'mcp.json'),
    configDir: join(homedir(), '.cursor'),
  },
};

function detectAgents() {
  const found = [];
  for (const [key, agent] of Object.entries(AGENTS)) {
    if (existsSync(agent.configDir)) found.push(key);
  }
  return found;
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

async function configureAgent(agentKey) {
  const agent = AGENTS[agentKey];
  if (!agent) {
    console.error(`❌ 未知 Agent: ${agentKey}，支持: ${Object.keys(AGENTS).join(', ')}`);
    process.exit(1);
  }

  await mkdir(agent.configDir, { recursive: true });
  const config = await readJsonFile(agent.configPath);

  if (remove) {
    if (config.mcpServers?.[serverName] || config.mcpServers?.[legacyServerName]) {
      delete config.mcpServers[serverName];
      delete config.mcpServers[legacyServerName];
      if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;
      await writeFile(agent.configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
      console.log(`✅ 已从 ${agent.name} 移除职程 MCP 配置`);
      console.log(`   ${agent.configPath}`);
    } else {
      console.log(`ℹ️  ${agent.name} 中没有职程 MCP 配置`);
    }
    return;
  }

  config.mcpServers = config.mcpServers || {};

  const existed = !!config.mcpServers[serverName];
  delete config.mcpServers[legacyServerName];
  config.mcpServers[serverName] = { url: mcpUrl };

  await writeFile(agent.configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  console.log(`✅ ${existed ? '更新' : '添加'} 职程 MCP → ${agent.name}`);
  console.log(`   配置文件: ${agent.configPath}`);
  console.log(`   MCP URL:  ${mcpUrl}`);
  console.log(`   👉 请重启 ${agent.name} 使配置生效`);
}

async function main() {
  const explicit = param('agent');

  if (explicit) {
    await configureAgent(explicit);
    return;
  }

  const detected = detectAgents();

  if (detected.length === 0) {
    console.log('❌ 未检测到已安装的 AI Agent（Claude Code / Cursor）');
    console.log('   手动指定: node setup-mcp.mjs --agent claude');
    process.exit(1);
  }

  console.log(`🔍 检测到 ${detected.length} 个 Agent:\n`);

  for (const key of detected) {
    await configureAgent(key);
    console.log();
  }

  if (!remove) {
    console.log('──────────────────────────────────');
    console.log('确保后端已启动: cd web/server && npm start');
    console.log('然后重启 Agent，连接会自动建立。');
  }
}

main().catch((e) => { console.error('错误:', e.message); process.exit(1); });
