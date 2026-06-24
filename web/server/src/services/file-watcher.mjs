import { EventEmitter } from 'node:events';
import { relative, resolve, sep } from 'node:path';
import chokidar from 'chokidar';

import { PROJECT_ROOT } from '../utils/paths.mjs';
import { invalidateDataCaches } from './data.mjs';
import { appendActivity } from './history-ledger.mjs';

const WATCHED_DIRECTORIES = ['data', 'reports', 'output', 'config'];
const EVENT_TYPES = { add: 'added', change: 'changed', unlink: 'removed' };

export const fileEvents = new EventEmitter();

function mergeType(previous, next) {
  if (!previous) return next;
  if (previous === 'added' && next === 'removed') return 'removed';
  if (previous === 'removed' && next === 'added') return 'changed';
  return next;
}

function relativeFile(root, filePath) {
  return relative(root, filePath).split(sep).join('/');
}

export function createFileWatcher({
  root = PROJECT_ROOT,
  debounceMs = 300,
  maxWaitMs = 1_500,
  emitter = fileEvents,
  invalidate = invalidateDataCaches,
  recordActivity = appendActivity,
  watch = chokidar.watch,
} = {}) {
  const pending = new Map();
  let debounceTimer;
  let maxWaitTimer;
  let closed = false;

  const flush = () => {
    clearTimeout(debounceTimer);
    clearTimeout(maxWaitTimer);
    debounceTimer = undefined;
    maxWaitTimer = undefined;
    if (closed || pending.size === 0) return;

    const batch = [...pending.values()];
    pending.clear();
    invalidate(batch.map((event) => event.absoluteFile));

    const ts = new Date().toISOString();
    for (const event of batch) {
      emitter.emit('file-change', { file: event.file, type: event.type, ts });
      if (event.type === 'added' && event.file.startsWith('reports/') && event.file.endsWith('.md')) {
        void recordActivity('report-added', `新增评估报告：${event.file}`, ts);
      }
      if (event.type === 'changed' && event.file === 'data/applications.md') {
        void recordActivity('status-changed', '投递记录状态或备注已更新', ts);
      }
    }
  };

  const schedule = (eventName, filePath) => {
    const type = EVENT_TYPES[eventName];
    if (!type || closed) return;

    const absoluteFile = resolve(filePath);
    const file = relativeFile(root, absoluteFile);
    const previous = pending.get(absoluteFile);
    pending.set(absoluteFile, {
      absoluteFile,
      file,
      type: mergeType(previous?.type, type),
    });

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
    maxWaitTimer ??= setTimeout(flush, maxWaitMs);
  };

  const watcher = watch(WATCHED_DIRECTORIES.map((directory) => resolve(root, directory)), {
    ignoreInitial: true,
    atomic: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  watcher.on('add', (filePath) => schedule('add', filePath));
  watcher.on('change', (filePath) => schedule('change', filePath));
  watcher.on('unlink', (filePath) => schedule('unlink', filePath));
  watcher.on('error', (error) => emitter.emit('watcher-error', error));

  return {
    emitter,
    flush,
    async close() {
      closed = true;
      clearTimeout(debounceTimer);
      clearTimeout(maxWaitTimer);
      pending.clear();
      await watcher.close();
    },
  };
}

export function startFileWatcher(options) {
  return createFileWatcher(options);
}
