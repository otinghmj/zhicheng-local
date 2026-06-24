#!/usr/bin/env node
/**
 * Local MCP Agent — connects to career-ops MCP server,
 * handles sampling requests (createMessage) by executing commands locally,
 * and polls for ops tasks as fallback.
 */
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const MCP_URL = process.argv[2] || 'https://touxian.buzz/mcp';
const POLL_INTERVAL_MS = 5_000;
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
const PROJECT_DIR = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function executePrompt(prompt) {
  log(`收到任务 prompt (${prompt.length} chars)`);

  // Parse known ops patterns
  const chromeMatch = prompt.match(/启动 Chrome 调试浏览器/);
  if (chromeMatch) {
    return launchChrome();
  }

  const scriptMatch = prompt.match(/执行脚本：node\s+(.+)/);
  if (scriptMatch) {
    return runScript(scriptMatch[1].trim());
  }

  const loginMatch = prompt.match(/打开登录页面：(https?:\/\/[^\s]+)/);
  if (loginMatch) {
    return openInChrome(loginMatch[1]);
  }

  return { success: false, error: `无法解析任务: ${prompt.slice(0, 100)}...` };
}

function launchChrome() {
  try {
    const check = execSync('curl -s http://localhost:9222/json/version', { timeout: 3000 }).toString();
    if (check.includes('Browser')) {
      log('Chrome 调试浏览器已在运行');
      return { success: true, response: 'Chrome 调试浏览器已在运行（端口 9222）' };
    }
  } catch { /* not running */ }

  log('正在启动 Chrome 调试浏览器...');
  try {
    const chrome = spawn(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ['--user-data-dir=' + process.env.HOME + '/chrome-boss-debug', '--remote-debugging-port=9222', '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check'],
      { stdio: 'ignore', detached: true },
    );
    chrome.unref();

    // Wait for startup
    for (let i = 0; i < 10; i++) {
      try {
        execSync('sleep 0.5');
        const v = execSync('curl -s http://localhost:9222/json/version', { timeout: 2000 }).toString();
        if (v.includes('Browser')) {
          log('Chrome 调试浏览器启动成功');
          return { success: true, response: 'Chrome 调试浏览器已启动（端口 9222）' };
        }
      } catch { /* waiting */ }
    }
    return { success: false, error: 'Chrome 启动超时' };
  } catch (err) {
    return { success: false, error: `启动失败: ${err.message}` };
  }
}

function runScript(cmdLine) {
  log(`执行脚本: node ${cmdLine}`);
  try {
    const output = execSync(`node ${cmdLine}`, {
      cwd: PROJECT_DIR,
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: '' },
    }).toString();
    log(`脚本执行完成 (${output.length} bytes output)`);
    return { success: true, response: output };
  } catch (err) {
    const stderr = err.stderr?.toString() || '';
    const stdout = err.stdout?.toString() || '';
    log(`脚本执行失败: ${err.message}`);
    return { success: false, error: `${err.message}\n${stderr}\n${stdout}`.slice(0, 2000) };
  }
}

function openInChrome(url) {
  log(`在 Chrome 中打开: ${url}`);
  try {
    execSync(`open -a "Google Chrome" "${url}"`, { timeout: 5000 });
    return { success: true, response: `已打开 ${url}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

let client;
let pollTimer;
let reconnectAttempts = 0;
let consecutivePollFailures = 0;
let reconnecting = false;
let shuttingDown = false;
const POLL_FAIL_THRESHOLD = 3;

function handleSamplingRequest(request) {
  const messages = request.params?.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const text = lastMessage?.content?.text ?? (typeof lastMessage?.content === 'string' ? lastMessage.content : '');

  if (!text) {
    return { model: 'local-agent', role: 'assistant', content: { type: 'text', text: 'empty prompt' } };
  }

  const result = executePrompt(text);
  const responseText = result.success
    ? (result.response || '执行成功')
    : `执行失败: ${result.error}`;

  return {
    model: 'local-agent',
    role: 'assistant',
    content: { type: 'text', text: responseText },
  };
}

async function pollOps() {
  if (!client || reconnecting) return;
  try {
    const result = await client.callTool({ name: 'claim_ops_task', arguments: {} });
    consecutivePollFailures = 0;
    const text = result.content?.[0]?.text ?? '';
    const parsed = JSON.parse(text);
    if (parsed.status === 'claimed') {
      log(`领取到运维任务: ${parsed.mode} (${parsed.jobId})`);
      const execResult = executePrompt(parsed.prompt);
      await client.callTool({
        name: 'complete_ops_task',
        arguments: {
          jobId: parsed.jobId,
          success: execResult.success,
          result: execResult.success ? execResult.response : undefined,
          error: execResult.success ? undefined : execResult.error,
        },
      });
      log(`运维任务完成: ${parsed.jobId}`);
    }
  } catch (err) {
    if (!err.message?.includes('Not Found')) {
      consecutivePollFailures++;
      if (consecutivePollFailures >= POLL_FAIL_THRESHOLD && !reconnecting) {
        log(`连续 ${consecutivePollFailures} 次 poll 失败，主动重连`);
        reconnecting = true;
        scheduleReconnect();
      }
    }
  }
}

async function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

  client = new Client(
    { name: 'local-mcp-agent', version: '1.0.0' },
    { capabilities: { sampling: {} } },
  );

  client.setRequestHandler(CreateMessageRequestSchema, handleSamplingRequest);

  transport.onerror = (err) => {
    log(`Transport error: ${err.message}`);
  };
  transport.onclose = () => {
    log('Transport closed');
    if (!shuttingDown) scheduleReconnect();
  };

  await client.connect(transport);
  reconnectAttempts = 0;
  consecutivePollFailures = 0;
  reconnecting = false;
  log('MCP 连接成功！');
}

function scheduleReconnect() {
  if (shuttingDown) return;
  clearInterval(pollTimer);
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts++;
  log(`将在 ${(delay / 1000).toFixed(0)}s 后重连 (第 ${reconnectAttempts} 次)...`);
  setTimeout(async () => {
    try {
      await connect();
      pollTimer = setInterval(pollOps, POLL_INTERVAL_MS);
      log('Agent 已就绪，等待任务...');
    } catch (err) {
      log(`重连失败: ${err.message}`);
      scheduleReconnect();
    }
  }, delay);
}

async function main() {
  log(`连接到 MCP 服务器: ${MCP_URL}`);
  log(`项目目录: ${PROJECT_DIR}`);

  try {
    await connect();
  } catch (err) {
    log(`初始连接失败: ${err.message}`);
    if (err.cause) log(`  cause: ${err.cause.message ?? err.cause}`);
    scheduleReconnect();
    return;
  }

  pollTimer = setInterval(pollOps, POLL_INTERVAL_MS);

  log('Agent 已就绪，等待任务...');
  log('按 Ctrl+C 退出');

  process.on('SIGINT', () => {
    shuttingDown = true;
    log('正在断开连接...');
    clearInterval(pollTimer);
    client?.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
