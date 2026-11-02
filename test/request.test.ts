import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequester, type RequesterConfig, type ResponseMeta } from '../src/core/request.js';
import { StoreshotConnectionError, StoreshotError, StoreshotTimeoutError } from '../src/errors.js';
import { envelope, json, recordingFetch, rejection, type Reply } from './helpers/recordingFetch.js';

const KEY = 'ss_test_SECRETsecretSECRET123';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup(replies: Reply[], over: Partial<RequesterConfig> = {}) {
  const { fetch, calls } = recordingFetch(...replies);
  const request = createRequester({
    apiKey: KEY,
    baseUrl: 'https://api.test/v1',
    fetch,
    timeoutMs: 60_000,
    maxRetries: 2,
    maxRetryAfterMs: 60_000,
    clientHeader: 'api/storeshot-sdk-js@0.0.0-dev',
    defaultHeaders: {},
    random: () => 0,
    ...over,
  });
  return { request, calls };
}

afterEach(() => vi.useRealTimers());

/** Runs a request while fake timers fast-forward every sleep. */
async function settle<T>(start: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const guarded = start().then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await guarded;
  vi.useRealTimers();
  if ('error' in result) throw result.error;
  return result.value;
}

describe('URL and headers', () => {
  it('encodes path parameters and skips empty query values', async () => {
    const { request, calls } = setup([json(200, {})]);
    await request('getGeneration', { path: { id: 'a b/c' }, query: { wait: undefined } });
    expect(calls[0].url).toBe('https://api.test/v1/generations/a%20b%2Fc');
    await request('listGenerations', { query: { limit: 5, status: 'queued', cursor: null } });
    expect(calls[1].url).toBe('https://api.test/v1/generations?limit=5&status=queued');
  });

  it('sends the credential, client header, Accept, JSON, Prefer and X-Request-Id', async () => {
    const { request, calls } = setup([json(202, { id: 'g' })]);
    await request('createGeneration', {
      json: { a: 1 },
      wait: 30,
      options: { requestId: 'trace-1', headers: { 'X-Extra': 'y' } },
    });
    const h = calls[0].headers;
    expect(calls[0].method).toBe('POST');
    expect(h.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(h.get('x-storeshot-client')).toBe('api/storeshot-sdk-js@0.0.0-dev');
    expect(h.get('accept')).toBe('application/json');
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('prefer')).toBe('wait=30');
    expect(h.get('x-request-id')).toBe('trace-1');
    expect(h.get('x-extra')).toBe('y');
    expect(calls[0].body).toBe('{"a":1}');
  });

  it('refuses a missing path parameter and SDK-owned per-call headers', async () => {
    const { request, calls } = setup([json(200, {})]);
    await expect(request('getGeneration', {})).rejects.toMatchObject({
      code: 'INVALID_CONFIGURATION',
    });
    await expect(
      request('getMe', { options: { headers: { Authorization: 'Bearer other' } } }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(calls).toHaveLength(0);
  });
});

describe('answers', () => {
  it('parses JSON, returns undefined for 204, hands binary answers to raw', async () => {
    const { request } = setup([
      json(200, { ok: true }),
      new Response(null, { status: 204 }),
      new Response('PK\u0003\u0004', { status: 200 }),
    ]);
    expect(await request('getMe')).toEqual({ ok: true });
    expect(await request('revokeApiKey', { path: { id: 'k' } })).toBeUndefined();
    const bytes = await request('getScreenshotSetArchive', {
      path: { id: 's' },
      raw: async (response) => new Uint8Array(await response.arrayBuffer()),
    });
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
  });

  it('throws the ErrorEnvelope as StoreshotError without retrying 4xx', async () => {
    const { request, calls } = setup([envelope(404, 'NOT_FOUND')]);
    const error = await rejection(request('getGeneration', { path: { id: 'x' } }));
    expect(error).toBeInstanceOf(StoreshotError);
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      requestId: 'req-env',
      operationId: 'getGeneration',
    });
    expect(calls).toHaveLength(1);
  });

  it('reports a 2xx body that is not JSON', async () => {
    const { request } = setup([new Response('<html>', { status: 200 })]);
    await expect(request('getMe')).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      status: 200,
    });
  });

  it('calls onResponse for every attempt with the response headers', async () => {
    const seen: ResponseMeta[] = [];
    const perCall: number[] = [];
    const { request } = setup(
      [
        envelope(503, 'SERVICE_UNAVAILABLE'),
        json(
          200,
          {},
          {
            ratelimit: '"key";r=5;t=10',
            'ratelimit-policy': '"key";q=60;w=60',
            'idempotent-replayed': 'true',
          },
        ),
      ],
      { onResponse: (meta) => seen.push(meta) },
    );
    await settle(() =>
      request('getMe', { options: { onResponse: (meta) => perCall.push(meta.status) } }),
    );
    expect(seen.map((m) => [m.status, m.attempt])).toEqual([
      [503, 0],
      [200, 1],
    ]);
    expect(perCall).toEqual([503, 200]);
    expect(seen[1]).toMatchObject({
      operationId: 'getMe',
      requestId: 'req-test',
      rateLimit: '"key";r=5;t=10',
      rateLimitPolicy: '"key";q=60;w=60',
      idempotentReplayed: true,
      retryAfterSeconds: null,
    });
    expect(seen[0].idempotentReplayed).toBeNull();
  });
});

describe('idempotency keys (D4)', () => {
  it('generates one key per call and reuses it across retries', async () => {
    const { request, calls } = setup([
      envelope(503, 'SERVICE_UNAVAILABLE'),
      new TypeError('fetch failed'),
      json(202, { id: 'g' }),
    ]);
    await settle(() => request('createGeneration', { json: {} }));
    expect(calls).toHaveLength(3);
    const keys = calls.map((c) => c.headers.get('idempotency-key'));
    expect(keys[0]).toMatch(UUID);
    expect(new Set(keys).size).toBe(1);
    await request('createGeneration', { json: {} });
    expect(calls[3].headers.get('idempotency-key')).not.toBe(keys[0]);
  });

  it('sends a caller key verbatim and validates it', async () => {
    const { request, calls } = setup([json(202, {})]);
    await request('createScreenshotSet', { json: {}, idempotencyKey: 'release-2.4' });
    expect(calls[0].headers.get('idempotency-key')).toBe('release-2.4');
    await expect(
      request('createScreenshotSet', { json: {}, idempotencyKey: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(
      request('createScreenshotSet', { json: {}, idempotencyKey: 'é' }),
    ).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
  });

  it('never sends a key where the contract declares none, nor for a quote', async () => {
    const { request, calls } = setup([json(200, {})]);
    await request('listGenerations');
    await request('createUpload', { json: { url: 'https://example.com/a.png' } });
    await request('createScreenshotSet', { json: {}, query: { dryRun: 'true' }, readOnly: true });
    expect(calls.map((c) => c.headers.has('idempotency-key'))).toEqual([false, false, false]);
  });
});

describe('retries (D4, spec §8)', () => {
  it('retries a quote (read-only POST) on 500', async () => {
    const { request, calls } = setup([json(500, {}), json(200, { dryRun: true })]);
    await settle(() =>
      request('createScreenshotSet', { json: {}, query: { dryRun: 'true' }, readOnly: true }),
    );
    expect(calls).toHaveLength(2);
  });

  it('does not repeat a plain POST after a 500 or a network error', async () => {
    const form = () => {
      const data = new FormData();
      data.append('file', new Blob([new Uint8Array([1])]), 'a.png');
      return data;
    };
    const failing = setup([envelope(500, 'INTERNAL_ERROR')]);
    await expect(failing.request('createUpload', { form })).rejects.toMatchObject({ status: 500 });
    expect(failing.calls).toHaveLength(1);
    const lost = setup([new TypeError('socket hang up')]);
    const error = await rejection(lost.request('createUpload', { form }));
    expect(error).toBeInstanceOf(StoreshotConnectionError);
    expect(error.code).toBe('CONNECTION_ERROR');
    expect(error.message).toContain('may have reached the server');
    expect(lost.calls).toHaveLength(1);
  });

  it('retries a 429 of a plain POST after Retry-After with a fresh multipart body', async () => {
    let built = 0;
    const form = () => {
      built += 1;
      const data = new FormData();
      data.append('file', new Blob([new Uint8Array([1])]), 'a.png');
      return data;
    };
    const { request, calls } = setup([
      envelope(429, 'RATE_LIMITED', { 'retry-after': '1' }),
      json(201, { id: 'u' }),
    ]);
    expect(await settle(() => request('createUpload', { form }))).toEqual({ id: 'u' });
    expect(calls).toHaveLength(2);
    expect(built).toBe(2);
    expect(calls[0].body).not.toBe(calls[1].body);
  });

  it('retries a busy 503 with Retry-After for a plain POST, not one without it', async () => {
    const busy = setup([
      envelope(503, 'SERVICE_UNAVAILABLE', { 'retry-after': '2' }),
      json(201, {}),
    ]);
    await settle(() =>
      busy.request('createUpload', { json: { url: 'https://example.com/a.png' } }),
    );
    expect(busy.calls).toHaveLength(2);
    const down = setup([envelope(503, 'SERVICE_UNAVAILABLE')]);
    await expect(down.request('createUpload', { json: { url: 'x' } })).rejects.toMatchObject({
      status: 503,
    });
    expect(down.calls).toHaveLength(1);
  });

  it('does not retry a DELETE on 502 but does retry palettes (read-only POST)', async () => {
    const del = setup([new Response('bad gateway', { status: 502 })]);
    await expect(del.request('revokeApiKey', { path: { id: 'k' } })).rejects.toMatchObject({
      status: 502,
      code: 'UNEXPECTED_RESPONSE',
    });
    expect(del.calls).toHaveLength(1);
    const palettes = setup([new Response('bad gateway', { status: 502 }), json(200, {})]);
    await settle(() => palettes.request('createPalette', { json: {} }));
    expect(palettes.calls).toHaveLength(2);
  });

  it('stops after maxRetries and throws the last error', async () => {
    const { request, calls } = setup([envelope(502, 'INTERNAL_ERROR')]);
    await expect(settle(() => request('getMe'))).rejects.toMatchObject({ status: 502 });
    expect(calls).toHaveLength(3);
    const once = setup([envelope(502, 'INTERNAL_ERROR')]);
    await expect(once.request('getMe', { options: { maxRetries: 0 } })).rejects.toMatchObject({
      status: 502,
    });
    expect(once.calls).toHaveLength(1);
  });

  it('does not wait for a Retry-After longer than maxRetryAfterMs', async () => {
    const { request, calls } = setup([envelope(429, 'RATE_LIMITED', { 'retry-after': '18000' })]);
    const error = await rejection(request('getMe'));
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 18000 });
    expect(calls).toHaveLength(1);
  });
});

describe('timeouts and aborts', () => {
  const hang: Reply = (call) =>
    new Promise<Response>((_resolve, reject) =>
      call.signal?.addEventListener('abort', () => reject(call.signal?.reason)),
    );

  it('times out an attempt and retries a GET', async () => {
    const { request, calls } = setup([hang, hang, hang], { timeoutMs: 1000 });
    const error = await rejection(settle(() => request('getMe')));
    expect(error).toBeInstanceOf(StoreshotTimeoutError);
    expect(error.code).toBe('TIMEOUT');
    expect(calls).toHaveLength(3);
  });

  it('rethrows the caller abort without retrying', async () => {
    const controller = new AbortController();
    const { request, calls } = setup([hang]);
    const pending = request('getMe', { options: { signal: controller.signal } });
    controller.abort(new DOMException('stop', 'AbortError'));
    const error = await rejection(pending);
    expect(error).toBeInstanceOf(DOMException);
    expect(error.name).toBe('AbortError');
    expect(calls).toHaveLength(1);
  });

  it('cancels a retry sleep when the caller aborts', async () => {
    const controller = new AbortController();
    const { request, calls } = setup([
      envelope(503, 'SERVICE_UNAVAILABLE', { 'retry-after': '30' }),
    ]);
    const pending = rejection(request('getMe', { options: { signal: controller.signal } }));
    await new Promise((r) => setTimeout(r, 10));
    controller.abort(new DOMException('stop', 'AbortError'));
    expect((await pending).name).toBe('AbortError');
    expect(calls).toHaveLength(1);
  });
});

describe('key hygiene', () => {
  it('never puts the key into an error', async () => {
    const cases = [
      setup([
        json(400, {
          error: { code: 'INVALID_INPUT', message: `got ${KEY}`, requestId: 'r', docUrl: 'd' },
        }),
      ]),
      setup([new TypeError(`connect failed for ${KEY}`)]),
    ];
    for (const { request } of cases) {
      const error = await rejection(request('createUpload', { json: {} }));
      for (const text of [error.message, String(error.stack), JSON.stringify(error)]) {
        expect(text).not.toContain(KEY);
      }
    }
  });
});
