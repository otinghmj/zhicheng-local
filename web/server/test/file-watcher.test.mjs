import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFileWatcher } from '../src/services/file-watcher.mjs';

class FakeWatcher extends EventEmitter {
  async close() {}
}

const root = '/tmp/career-ops-watcher-test';
const instances = [];

function setup(options = {}) {
  const watcher = new FakeWatcher();
  instances.push(watcher);
  const invalidate = vi.fn();
  const emitter = new EventEmitter();
  const events = [];
  emitter.on('file-change', (event) => events.push(event));
  const service = createFileWatcher({
    root,
    emitter,
    invalidate,
    recordActivity: vi.fn(),
    debounceMs: 300,
    maxWaitMs: 1_000,
    watch: vi.fn(() => watcher),
    ...options,
  });
  return { watcher, invalidate, events, service };
}

afterEach(() => {
  vi.useRealTimers();
  instances.length = 0;
});

describe('file watcher', () => {
  it('同一文件 300ms 内的连续变化只广播一次', async () => {
    vi.useFakeTimers();
    const { watcher, events, invalidate, service } = setup();
    const file = resolve(root, 'data/applications.md');

    watcher.emit('change', file);
    await vi.advanceTimersByTimeAsync(200);
    watcher.emit('change', file);
    await vi.advanceTimersByTimeAsync(299);
    expect(events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ file: 'data/applications.md', type: 'changed' });
    expect(events[0].ts).toEqual(expect.any(String));
    expect(invalidate).toHaveBeenCalledOnce();
    await service.close();
  });

  it('批量写入合并为一次缓存失效，但逐文件广播', async () => {
    vi.useFakeTimers();
    const { watcher, events, invalidate, service } = setup();
    watcher.emit('add', resolve(root, 'reports/a.md'));
    watcher.emit('change', resolve(root, 'data/pipeline.md'));
    watcher.emit('unlink', resolve(root, 'output/a.pdf'));
    await vi.advanceTimersByTimeAsync(300);

    expect(invalidate).toHaveBeenCalledOnce();
    expect(invalidate.mock.calls[0][0]).toHaveLength(3);
    expect(events.map((event) => event.type)).toEqual(['added', 'changed', 'removed']);
    await service.close();
  });

  it('持续事件风暴达到最大等待时间后也会刷新', async () => {
    vi.useFakeTimers();
    const { watcher, events, service } = setup();
    for (let index = 0; index < 5; index += 1) {
      watcher.emit('change', resolve(root, `reports/${index}.md`));
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(events).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(300);
    expect(events).toHaveLength(5);
    await service.close();
  });

  it('删除后重新添加同一文件合并为 changed', async () => {
    vi.useFakeTimers();
    const { watcher, events, service } = setup();
    const file = resolve(root, 'config/profile.yml');
    watcher.emit('unlink', file);
    watcher.emit('add', file);
    await vi.advanceTimersByTimeAsync(300);
    expect(events[0]).toMatchObject({ file: 'config/profile.yml', type: 'changed' });
    await service.close();
  });
});
