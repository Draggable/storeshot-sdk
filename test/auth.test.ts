import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Storeshot, StoreshotError } from '../src/index.js';
import { envelope, json, recordingFetch, rejection } from './helpers/recordingFetch.js';

const DEVICE = 'D'.repeat(43);
const KEY = `ss_test_${'a'.repeat(43)}`;
const KEY_ID = '00000000-0000-4000-8000-000000000009';
const started = json(200, {
  device_code: DEVICE,
  user_code: 'BCDF-GHJK',
  verification_uri: 'https://console.storeshot.art/device',
  verification_uri_complete: 'https://console.storeshot.art/device?code=BCDF-GHJK',
  expires_in: 600,
  interval: 5,
});
const oauth = (error: string, headers: Record<string, string> = {}) =>
  json(400, { error, error_description: `${error} text` }, headers);
const token = json(200, {
  access_token: KEY,
  token_type: 'Bearer',
  scope: 'usage:read generations:read',
  key_id: KEY_ID,
  environment: 'test',
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** Runs `promise` while advancing fake time, and records how long each sleep lasted. */
async function drive<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) await vi.advanceTimersByTimeAsync(1000);
  return promise;
}

const client = (fetch: typeof globalThis.fetch) =>
  new Storeshot({ apiKey: null, baseUrl: 'https://api.test/v1', fetch });

describe('client.auth (SS-019 device authorization)', () => {
  it('linkAccount: start → pending → slow_down (+5 s) → approved; no Authorization, JSON', async () => {
    const { fetch, calls } = recordingFetch(
      started,
      oauth('authorization_pending'),
      oauth('slow_down', { 'retry-after': '10' }),
      token,
    );
    const onCode = vi.fn();
    const at: number[] = [];
    const t0 = Date.now();
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      at.push(Date.now() - t0);
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    const result = await drive(
      client(wrapped).auth.linkAccount({ clientName: 'my-cli', environment: 'test', onCode }),
    );
    expect(onCode).toHaveBeenCalledWith({
      userCode: 'BCDF-GHJK',
      verificationUri: 'https://console.storeshot.art/device',
      verificationUriComplete: 'https://console.storeshot.art/device?code=BCDF-GHJK',
      expiresIn: 600,
    });
    expect(result).toEqual({
      apiKey: KEY,
      keyId: KEY_ID,
      scopes: ['usage:read', 'generations:read'],
      environment: 'test',
    });
    // Polls at 5 s and 10 s, then 10 s after the slow_down (interval 5 + 5).
    expect(at.map((ms) => Math.round(ms / 1000))).toEqual([0, 5, 10, 20]);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/v1/auth/device',
      '/v1/auth/device/token',
      '/v1/auth/device/token',
      '/v1/auth/device/token',
    ]);
    for (const c of calls) {
      expect(c.headers.get('authorization')).toBeNull();
      expect(c.headers.get('content-type')).toBe('application/json');
    }
    expect(JSON.parse(String(calls[0].body))).toEqual({
      client_name: 'my-cli',
      environment: 'test',
    });
    expect(JSON.parse(String(calls[1].body))).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: DEVICE,
    });
  });

  it.each([
    ['access_denied', 'DEVICE_ACCESS_DENIED'],
    ['expired_token', 'DEVICE_CODE_EXPIRED'],
    ['invalid_grant', 'DEVICE_INVALID_GRANT'],
  ])('%s stops with StoreshotError %s', async (error, code) => {
    const { fetch } = recordingFetch(started, oauth(error));
    const err = await drive(rejection(client(fetch).auth.linkAccount({ onCode: () => {} })));
    expect(err).toBeInstanceOf(StoreshotError);
    expect(err).toMatchObject({ code, status: 400, details: { error } });
  });

  it('a 400 slow_down is answered once, never retried by the core retry', async () => {
    const { fetch, calls } = recordingFetch(oauth('slow_down', { 'retry-after': '15' }));
    const poll = await client(fetch).auth.pollDeviceToken(DEVICE);
    expect(poll).toEqual({ status: 'slow_down', retryAfterSeconds: 15 });
    expect(calls).toHaveLength(1);
  });

  it('a slow_down with a longer Retry-After waits that long', async () => {
    const { fetch } = recordingFetch(started, oauth('slow_down', { 'retry-after': '40' }), token);
    const at: number[] = [];
    const t0 = Date.now();
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      at.push(Date.now() - t0);
      return fetch(input, init);
    }) as typeof globalThis.fetch;
    await drive(client(wrapped).auth.linkAccount({ onCode: () => {} }));
    expect(at.map((ms) => Math.round(ms / 1000))).toEqual([0, 5, 45]);
  });

  it('gives up with DEVICE_CODE_EXPIRED after expires_in', async () => {
    const short = json(200, {
      device_code: DEVICE,
      user_code: 'BCDF-GHJK',
      verification_uri: 'https://console.storeshot.art/device',
      verification_uri_complete: 'https://console.storeshot.art/device?code=BCDF-GHJK',
      expires_in: 12,
      interval: 5,
    });
    const { fetch, calls } = recordingFetch(short, oauth('authorization_pending'));
    const err = await drive(rejection(client(fetch).auth.linkAccount({ onCode: () => {} })));
    expect(err).toMatchObject({ code: 'DEVICE_CODE_EXPIRED' });
    expect(calls.length).toBe(3);
  });

  it('an abort signal stops linkAccount', async () => {
    const { fetch } = recordingFetch(started, oauth('authorization_pending'));
    const controller = new AbortController();
    const p = rejection(
      client(fetch).auth.linkAccount({
        onCode: () => controller.abort(new Error('stop')),
        signal: controller.signal,
      }),
    );
    expect((await drive(p)).message).toBe('stop');
  });

  it('other errors keep the envelope handling (404 while disabled on the server)', async () => {
    const { fetch } = recordingFetch(envelope(404, 'NOT_FOUND'));
    const err = await rejection(client(fetch).auth.startDeviceAuthorization());
    expect(err).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('a client with a key sends no Authorization to the device endpoints either', async () => {
    const { fetch, calls } = recordingFetch(started);
    await new Storeshot({
      apiKey: KEY,
      baseUrl: 'https://api.test/v1',
      fetch,
    }).auth.startDeviceAuthorization({
      scopes: ['usage:read', 'billing:read'],
    });
    expect(calls[0].headers.get('authorization')).toBeNull();
    expect(JSON.parse(String(calls[0].body))).toEqual({ scope: 'usage:read billing:read' });
  });
});

describe('apiKey: null', () => {
  it('builds a key-less client; other methods throw MISSING_API_KEY before any request', async () => {
    vi.stubEnv('STORESHOT_API_KEY', KEY);
    const { fetch, calls } = recordingFetch(json(200, {}));
    const c = client(fetch);
    expect(String(c)).toBe('Storeshot(baseUrl=https://api.test/v1, apiKey=none)');
    expect(JSON.stringify(c)).not.toContain(KEY);
    const err = await rejection(c.me());
    expect(err).toMatchObject({ code: 'MISSING_API_KEY', operationId: 'getMe' });
    expect(calls).toHaveLength(0);
  });

  it('undefined keeps today’s behaviour (environment, else MISSING_API_KEY at construction)', () => {
    vi.stubEnv('STORESHOT_API_KEY', '');
    expect(() => new Storeshot({})).toThrow(StoreshotError);
  });
});
