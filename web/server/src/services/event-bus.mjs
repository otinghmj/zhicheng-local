import { fileEvents } from './file-watcher.mjs';

const clients = new Set();
let heartbeatTimer;

const FILE_TO_EVENT = {
  'data/applications.md': 'applications-updated',
  'data/pipeline.md': 'pipeline-updated',
  'config/profile.yml': 'config-updated',
  'portals.yml': 'config-updated',
  'cv.md': 'config-updated',
  'modes/_profile.md': 'config-updated',
};

function classifyFileEvent(file, type) {
  const event = FILE_TO_EVENT[file];
  if (event) {
    const data = { timestamp: new Date().toISOString() };
    if (event === 'config-updated') data.filename = file;
    return { event, data };
  }
  if (file.startsWith('reports/') && file.endsWith('.md') && type === 'added') {
    return { event: 'report-added', data: { file, timestamp: new Date().toISOString() } };
  }
  if (file.startsWith('batch/')) {
    return { event: 'batch-updated', data: { file, timestamp: new Date().toISOString() } };
  }
  return { event: 'external-change', data: { file, type, timestamp: new Date().toISOString() } };
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const response of clients) {
    response.write(payload);
  }
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const ping = `:heartbeat ${Date.now()}\n\n`;
    for (const response of clients) {
      response.write(ping);
    }
  }, 30_000);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}

fileEvents.on('file-change', ({ file, type, ts }) => {
  const { event, data } = classifyFileEvent(file, type);
  data.ts = ts;
  broadcast(event, data);
});

export function emitJobProgress(jobId, progress, script) {
  const data = { jobId, progress, timestamp: new Date().toISOString() };
  if (script) data.script = script;
  broadcast('script-progress', data);
}

export function emitJobCompleted(jobId, script, exitCode) {
  broadcast('script-completed', { jobId, script, exitCode, timestamp: new Date().toISOString() });
}

export function emitJobFailed(jobId, script, error) {
  broadcast('script-failed', { jobId, script, error, timestamp: new Date().toISOString() });
}

export function addClient(response) {
  clients.add(response);
  if (clients.size === 1) startHeartbeat();
  response.on('close', () => {
    clients.delete(response);
    if (clients.size === 0) stopHeartbeat();
  });
}

export function emitAgentChanged(count) {
  broadcast('agent-changed', { agentConnections: count, timestamp: new Date().toISOString() });
}

export function getClientCount() {
  return clients.size;
}
