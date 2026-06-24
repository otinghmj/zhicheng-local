import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { app } from '../src/app.mjs';

let server;
let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

async function json(path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { response, body: await response.json() };
}

describe('GET API', () => {
  it('health 返回本地模式', async () => {
    const { response, body } = await json('/api/health');
    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, mode: 'local' });
  });

  it('applications 返回数组', async () => {
    const { response, body } = await json('/api/data/applications');
    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('pipeline 返回计数和最近处理时间', async () => {
    const { body } = await json('/api/data/pipeline');
    expect(body).toMatchObject({ pendingCount: expect.any(Number), processedCount: expect.any(Number), lastProcessed: expect.any(String) });
  });

  it('任务历史端点返回 TSV 文本', async () => {
    const response = await fetch(`${baseUrl}/api/task-history`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/tab-separated-values');
    expect(typeof await response.text()).toBe('string');
  });

  it('返回基础简历内容和修改时间', async () => {
    const { response, body } = await json('/api/data/cv');
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ content: expect.any(String), lastModified: expect.any(String) });
  });

  it('返回四个平台的完整城市代码', async () => {
    const { response, body } = await json('/api/config/cities');
    expect(response.status).toBe(200);
    expect(body.boss.length).toBeGreaterThan(300);
    expect(body.zhaopin.length).toBeGreaterThan(400);
    expect(body['51job'].length).toBeGreaterThan(3000);
    expect(body.liepin.length).toBeGreaterThan(280);
    expect(body.liepin).toContainEqual({ name: '北京', code: '010' });
    expect(body.liepin).toContainEqual({ name: '佛山', code: '050050' });
    expect(body.liepin.some((city) => city.name.startsWith('_'))).toBe(false);
  });

  it('ai-tasks 不在白名单的 mode 返回 400', async () => {
    const response = await fetch(`${baseUrl}/api/ai-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'hacked', target: '123' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('ai-tasks 缺少 target 返回 400', async () => {
    const response = await fetch(`${baseUrl}/api/ai-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'oferta' }),
    });
    expect(response.status).toBe(400);
  });

  it('SSE 端点返回 text/event-stream 并发送 connected 事件', async () => {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    const reader = response.body.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('"type":"connected"');
    controller.abort();
  });
});
