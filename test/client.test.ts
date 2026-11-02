import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Storeshot, StoreshotError } from '../src/index.js';
import { json, recordingFetch } from './helpers/recordingFetch.js';

const KEY = 'ss_test_SECRETsecretSECRET123';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StoreshotError);
    return (error as StoreshotError).code;
  }
  return 'no error';
};

describe('API key', () => {
  it('comes from the option, else STORESHOT_API_KEY', async () => {
    const { fetch, calls } = recordingFetch(json(200, {}));
    vi.stubEnv('STORESHOT_API_KEY', 'ss_test_fromEnvironment1');
    await new Storeshot({ fetch }).me();
    await new Storeshot({ fetch, apiKey: KEY }).me();
    expect(calls.map((c) => c.headers.get('authorization'))).toEqual([
      'Bearer ss_test_fromEnvironment1',
      `Bearer ${KEY}`,
    ]);
  });

  it('is required, with guidance that never asks for the key in a chat', () => {
    vi.stubEnv('STORESHOT_API_KEY', '');
    try {
      new Storeshot();
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'MISSING_API_KEY', status: 0 });
      expect((error as Error).message).toContain('STORESHOT_API_KEY');
      expect((error as Error).message).toContain('https://console.storeshot.art/');
    }
  });

  it('refuses whitespace and control characters', () => {
    expect(code(() => new Storeshot({ apiKey: `${KEY}\n` }))).toBe('INVALID_CONFIGURATION');
  });

  it('never shows the key', () => {
    const client = new Storeshot({ apiKey: KEY });
    const views = [
      String(client),
      JSON.stringify(client),
      inspect(client),
      inspect(client, { showHidden: true, depth: 5 }),
      (client as unknown as Record<symbol, () => string>)[Symbol.for('Deno.customInspect')](),
      JSON.stringify(Object.getOwnPropertyNames(client)),
    ];
    for (const view of views) expect(view).not.toContain('SECRET');
    expect(String(client)).toBe(
      'Storeshot(baseUrl=https://api.storeshot.art/v1, apiKey=ss_test_…)',
    );
  });
});

describe('base URL', () => {
  it('uses the option, else STORESHOT_BASE_URL, else the platform', () => {
    expect(new Storeshot({ apiKey: KEY }).baseUrl).toBe('https://api.storeshot.art/v1');
    vi.stubEnv('STORESHOT_BASE_URL', 'http://127.0.0.1:3001/v1/');
    expect(new Storeshot({ apiKey: KEY }).baseUrl).toBe('http://127.0.0.1:3001/v1');
    expect(new Storeshot({ apiKey: KEY, baseUrl: 'https://staging.example/v1' }).baseUrl).toBe(
      'https://staging.example/v1',
    );
  });

  it.each(['http://localhost:9/v1', 'http://[::1]:9/v1', 'http://127.0.0.2/v1'])(
    'allows plain http for loopback %s',
    (baseUrl) => expect(new Storeshot({ apiKey: KEY, baseUrl }).baseUrl).toBe(baseUrl),
  );

  it.each([
    'http://api.storeshot.art/v1',
    'ftp://x/v1',
    '/v1',
    'https://user:pw@api.storeshot.art/v1',
    'https://api.storeshot.art/v1?x=1',
  ])('refuses %s', (baseUrl) => {
    expect(code(() => new Storeshot({ apiKey: KEY, baseUrl }))).toBe('INVALID_CONFIGURATION');
  });
});

describe('other options', () => {
  it('refuses a web page unless dangerouslyAllowBrowser', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    expect(code(() => new Storeshot({ apiKey: KEY }))).toBe('BROWSER_NOT_ALLOWED');
    expect(new Storeshot({ apiKey: KEY, dangerouslyAllowBrowser: true })).toBeInstanceOf(Storeshot);
  });

  it('validates numbers, client identity and default headers', () => {
    expect(code(() => new Storeshot({ apiKey: KEY, timeoutMs: -1 }))).toBe('INVALID_CONFIGURATION');
    expect(code(() => new Storeshot({ apiKey: KEY, maxRetries: 11 }))).toBe(
      'INVALID_CONFIGURATION',
    );
    expect(code(() => new Storeshot({ apiKey: KEY, client: { name: 'a/b' } }))).toBe(
      'INVALID_CONFIGURATION',
    );
    expect(
      code(() => new Storeshot({ apiKey: KEY, defaultHeaders: { 'Idempotency-Key': 'x' } })),
    ).toBe('INVALID_CONFIGURATION');
  });

  it('sends the client identity and default headers', async () => {
    const { fetch, calls } = recordingFetch(json(200, {}));
    await new Storeshot({
      apiKey: KEY,
      fetch,
      client: { surface: 'cli', name: 'storeshot-cli@0.3.1' },
      defaultHeaders: { 'X-Team': 'growth' },
    }).me();
    expect(calls[0].headers.get('x-storeshot-client')).toBe('cli/storeshot-cli@0.3.1');
    expect(calls[0].headers.get('x-team')).toBe('growth');
  });

  it('uses the global fetch when none is given', async () => {
    const { fetch, calls } = recordingFetch(json(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetch);
    expect(await new Storeshot({ apiKey: KEY }).health()).toEqual({ status: 'ok' });
    expect(calls[0].url).toBe('https://api.storeshot.art/v1/health');
    await new Storeshot({ apiKey: KEY }).status();
    expect(calls[1].url).toBe('https://api.storeshot.art/v1/status');
  });
});
