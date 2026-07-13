#!/usr/bin/env node
/**
 * 一键配置 AI Agent 连接职程 MCP Server
 *
 * 用法:
 *   node setup-mcp.mjs                  # 自动检测已安装的 Agent 并写入配置
 *   node setup-mcp.mjs --agent claude    # Claude Code（写项目根 .mcp.json）
 *   node setup-mcp.mjs --agent cursor    # Cursor（写 ~/.cursor/mcp.json）
 *   node setup-mcp.mjs --print           # 只打印可粘贴的通用配置，不写文件（任意 Agent）
 *   node setup-mcp.mjs --port 3200       # 自定义端口
 *   node setup-mcp.mjs --remove          # 移除配置
 *
 * 设计说明：
 *   MCP 连接对任意支持 Streamable HTTP 的 Agent 都通用，配置内容永远是同一个 URL。
 *   本脚本只是帮已知位置的 Agent（Claude Code / Cursor）自动写文件；
 *   其它 Agent 用 --print 拿到配置片段，按各自方式粘贴即可。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
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
const mcpUrl = process.env.MCP_PUBLIC_URL || `http://localhost:${port}/mcp`;
const remove = flag('remove');
const serverName = 'zhicheng';

// Claude Code 从「项目根 .mcp.json」读取 MCP（不是 ~/.claude/settings.json）。
// Cursor 从「~/.cursor/mcp.json」读取。两者配置形状略有差别，用 entry() 生成。
const AGENTS = {
  claude: {
    name: 'Claude Code',
    configPath: join(projectRoot, '.mcp.json'),
    configDir: projectRoot,
    // Claude Code 用 type: http 表示 Streamable HTTP 端点。
    entry: () => ({ type: 'http', url: mcpUrl }),
    detect: () => existsSync(join(homedir(), '.claude')) || existsSync(join(homedir(), '.claude.json')),
  },
  cursor: {
    name: 'Cursor',
    configPath: join(homedir(), '.cursor', 'mcp.json'),
    configDir: join(homedir(), '.cursor'),
    entry: () => ({ url: mcpUrl }),
    detect: () => existsSync(join(homedir(), '.cursor')),
  },
};

function detectAgents() {
  return Object.entries(AGENTS).filter(([, a]) => a.detect()).map(([key]) => key);
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

function printGeneric() {
  const snippet = JSON.stringify({ mcpServers: { [serverName]: { type: 'http', url: mcpUrl } } }, null, 2);
  console.log('\n任意支持 MCP（Streamable HTTP）的 Agent 都可用以下配置：\n');
  console.log(`  MCP URL: ${mcpUrl}\n`);
  console.log(snippet);
  console.log('\n- Claude Code：写入项目根 .mcp.json（或 `claude mcp add --transport http zhicheng ' + mcpUrl + '`）');
  console.log('- Cursor：写入 ~/.cursor/mcp.json');
  console.log('- 其它 Agent：按各自 MCP 配置方式添加上面的 URL');
  console.log('\n连接后，Agent 请阅读项目根 AGENTS.md 了解如何驱动职程。');
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
    if (config.mcpServers?.[serverName]) {
      delete config.mcpServers[serverName];
      if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;
      await writeFile(agent.configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
      console.log(`✅ 已从 ${agent.name} 移除职程 MCP 配置（${agent.configPath}）`);
    } else {
      console.log(`ℹ️  ${agent.name} 中没有职程 MCP 配置`);
    }
    return;
  }

  config.mcpServers = config.mcpServers || {};
  const existed = !!config.mcpServers[serverName];
  config.mcpServers[serverName] = agent.entry();

  await writeFile(agent.configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  console.log(`✅ ${existed ? '更新' : '添加'} 职程 MCP → ${agent.name}`);
  console.log(`   配置文件: ${agent.configPath}`);
  console.log(`   MCP URL:  ${mcpUrl}`);
  console.log(`   👉 请重启 ${agent.name} 使配置生效`);
}

async function main() {
  if (flag('print')) {
    printGeneric();
    return;
  }

  const explicit = param('agent');
  if (explicit) {
    await configureAgent(explicit);
    return;
  }

  const detected = detectAgents();

  if (detected.length === 0) {
    console.log('❌ 未自动检测到 Claude Code / Cursor。');
    console.log('   手动指定：node setup-mcp.mjs --agent claude');
    console.log('   或打印通用配置：node setup-mcp.mjs --print');
    process.exit(1);
  }

  console.log(`🔍 检测到 ${detected.length} 个 Agent:\n`);
  for (const key of detected) {
    await configureAgent(key);
    console.log();
  }

  if (!remove) {
    console.log('──────────────────────────────────');
    console.log('确保后端已启动：cd web/server && npm start');
    console.log('然后重启 Agent，连接会自动建立。');
    console.log('连接后 Agent 请阅读项目根 AGENTS.md 了解如何驱动职程。');
  }
}

main().catch((e) => { console.error('错误:', e.message); process.exit(1); });
