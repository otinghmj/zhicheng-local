import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const { app } = await import('./app.mjs');
const { startFileWatcher } = await import('./services/file-watcher.mjs');

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 3200);

const watcher = startFileWatcher();
const server = app.listen(PORT, HOST, () => {
  console.log(`Career-Ops Local server listening on http://${HOST}:${PORT} (本地模式)`);
});

async function shutdown() {
  if (watcher) await watcher.close();
  server.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
