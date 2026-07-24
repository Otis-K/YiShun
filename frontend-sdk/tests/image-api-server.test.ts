// @vitest-environment node
import { createServer } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_IMAGE_MODEL, failureReason, generateTmlabImage, generateTmlabVideo } from '../demo/image-api-server';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('demo image generation server', () => {
  test('submits, polls, and downloads a generated image without exposing the API key', async () => {
    const requests: Array<{ method?: string; url?: string; authorization?: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        requests.push({
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        if (request.method === 'POST' && request.url === '/v1/tasks') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ task_id: 'task-1' }));
          return;
        }
        if (request.method === 'GET' && request.url === '/v1/tasks/task-1') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ status: 'completed', progress: 100, metadata: { url: '/result/task-1.png' } }));
          return;
        }
        if (request.method === 'GET' && request.url === '/v1/tasks/task-1/content') {
          response.setHeader('Content-Type', 'image/png');
          response.end(Buffer.from([137, 80, 78, 71]));
          return;
        }
        response.statusCode = 404;
        response.end();
      });
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP address');

    const result = await generateTmlabImage({
      apiKey: 'test-secret',
      baseURL: `http://127.0.0.1:${address.port}`,
      pollIntervalMs: 1,
    }, {
      prompt: '雨夜车站中的电影感人物肖像',
      model: DEFAULT_IMAGE_MODEL,
      size: '2K',
      aspectRatio: '16:9',
    }, new AbortController().signal);

    expect(result.taskId).toBe('task-1');
    expect(result.contentType).toBe('image/png');
    expect([...result.content]).toEqual([137, 80, 78, 71]);
    expect(requests).toHaveLength(3);
    expect(requests.every(request => request.authorization === 'Bearer test-secret')).toBe(true);
    expect(JSON.parse(requests[0].body)).toMatchObject({
      model: DEFAULT_IMAGE_MODEL,
      size: '2K',
      metadata: { aspectRatio: '16:9' },
    });
    expect(JSON.stringify(requests)).not.toContain('apiKey');
  });

  test('rejects generation before making a provider request when the key is missing', async () => {
    await expect(generateTmlabImage({ apiKey: '', baseURL: 'https://example.invalid' }, {
      prompt: 'test',
      model: DEFAULT_IMAGE_MODEL,
    }, new AbortController().signal)).rejects.toThrow('API Key');
  });

  test('extracts the provider failure reason from nested task details', () => {
    expect(failureReason({
      status: 'failed',
      data: { result: { error: { detail: '账户余额不足' } } },
    })).toBe('账户余额不足');
  });

  test('submits a Seedance Pro video task with a public reference image and downloads the MP4', async () => {
    let baseURL = '';
    let submitted: Record<string, unknown> | undefined;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        if (request.method === 'GET' && request.url === '/v1/models') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ data: [{ id: 'seedance-2.0-pro(431)' }] }));
          return;
        }
        if (request.method === 'POST' && request.url === '/v1/tasks') {
          submitted = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ task_id: 'video-task-1' }));
          return;
        }
        if (request.method === 'GET' && request.url === '/v1/tasks/video-task-1') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ status: 'completed', progress: 100, result_url: `${baseURL}/result.mp4` }));
          return;
        }
        if (request.method === 'GET' && request.url === '/result.mp4') {
          response.setHeader('Content-Type', 'video/mp4');
          response.end(Buffer.from([0, 0, 0, 24, 102, 116, 121, 112]));
          return;
        }
        response.statusCode = 404;
        response.end();
      });
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP address');
    baseURL = `http://127.0.0.1:${address.port}`;

    const result = await generateTmlabVideo({ apiKey: 'video-secret', baseURL, pollIntervalMs: 1 }, {
      prompt: '小猫自然地抬头并眨眼',
      model: 'seedance-2.0-pro(431)',
      ratio: '16:9',
      resolution: '720p',
      duration: 4,
      referenceImages: ['https://example.com/cat.png'],
    }, new AbortController().signal);

    expect(result.taskId).toBe('video-task-1');
    expect(result.contentType).toBe('video/mp4');
    expect([...result.content]).toEqual([0, 0, 0, 24, 102, 116, 121, 112]);
    expect(submitted).toMatchObject({
      model: 'seedance-2.0-pro(431)', duration: 4, ratio: '16:9', resolution: '720p',
      referenceImages: ['https://example.com/cat.png'],
    });
  });

  test('does not resubmit a billable video task when the provider has no model channel', async () => {
    let submissions = 0;
    const server = createServer((request, response) => {
      if (request.method === 'POST' && request.url === '/v1/tasks') submissions += 1;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'nano-banana-pro(特价版 1)' }] }));
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP address');

    await expect(generateTmlabVideo({
      apiKey: 'video-secret', baseURL: `http://127.0.0.1:${address.port}`, pollIntervalMs: 1,
    }, {
      prompt: 'test', model: 'seedance-2.0-pro(431)', ratio: '16:9', resolution: '720p', duration: 4,
    }, new AbortController().signal)).rejects.toThrow('未开通');
    expect(submissions).toBe(0);
  });
});
