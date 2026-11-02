import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getWebCrypto, loadNodeModule, randomUUID } from '../src/core/crypto.js';
import { isBrowserLike, readEnv } from '../src/core/env.js';
import {
  assertCredential,
  assertRequestId,
  clientHeader,
  userHeaders,
} from '../src/core/headers.js';
import { attemptSignal, sleep } from '../src/core/signal.js';
import { StoreshotError } from '../src/errors.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('env', () => {
  it('reads process.env and survives a runtime without process', () => {
    vi.stubEnv('STORESHOT_TEST_VAR', 'x');
    expect(readEnv('STORESHOT_TEST_VAR')).toBe('x');
    vi.stubEnv('STORESHOT_TEST_VAR', '');
    expect(readEnv('STORESHOT_TEST_VAR')).toBeUndefined();
    vi.stubGlobal('process', undefined);
    expect(readEnv('PATH')).toBeUndefined();
  });
  it('detects a page context only with window and document', () => {
    expect(isBrowserLike()).toBe(false);
    vi.stubGlobal('window', {});
    expect(isBrowserLike()).toBe(false);
    vi.stubGlobal('document', {});
    expect(isBrowserLike()).toBe(true);
  });
});

describe('headers', () => {
  it('builds the default X-Storeshot-Client value', () => {
    expect(clientHeader()).toBe('api/storeshot-sdk-js@0.0.0-dev');
    expect(clientHeader({ surface: 'cli', name: 'storeshot-cli@0.3.1' })).toBe(
      'cli/storeshot-cli@0.3.1',
    );
  });
  it.each([
    { name: 'my/tool' },
    { name: 'my tool' },
    { name: 'x'.repeat(101) },
    { name: '' },
    { surface: 'mobile' as never },
  ])('refuses %o', (client) => {
    expect(() => clientHeader(client)).toThrow(StoreshotError);
    try {
      clientHeader(client);
    } catch (error) {
      expect((error as StoreshotError).code).toBe('INVALID_CONFIGURATION');
    }
  });
  it('validates credentials, request ids and user headers', () => {
    expect(() => assertCredential('ss_test_abc\n')).toThrow(/whitespace/);
    expect(() => assertCredential('ss_test abc')).toThrow(StoreshotError);
    expect(() => assertCredential('ss_test_abc')).not.toThrow();
    expect(() => assertRequestId('a b')).toThrow(StoreshotError);
    expect(() => assertRequestId('req-1_=')).not.toThrow();
    expect(() => userHeaders({ Authorization: 'x' })).toThrow(/set by the SDK/);
    expect(() => userHeaders({ 'Idempotency-Key': 'x' })).toThrow(StoreshotError);
    expect(() => userHeaders({ 'X-Storeshot-Client': 'x' })).toThrow(StoreshotError);
    expect(() => userHeaders({ 'X-Trace': 'a\r\nb' })).toThrow(/line break/);
    expect(userHeaders({ 'X-Trace': 'abc' })).toEqual({ 'X-Trace': 'abc' });
  });
});

describe('signals', () => {
  it('times out an attempt', async () => {
    vi.useFakeTimers();
    const attempt = attemptSignal(undefined, 1000);
    vi.advanceTimersByTime(999);
    expect(attempt.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.timedOut()).toBe(true);
    expect((attempt.signal.reason as DOMException).name).toBe('TimeoutError');
  });
  it('follows the caller signal and cleans up', () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const attempt = attemptSignal(caller.signal, 1000);
    caller.abort(new Error('stop'));
    expect(attempt.signal.aborted).toBe(true);
    expect(attempt.timedOut()).toBe(false);
    expect((attempt.signal.reason as Error).message).toBe('stop');
    const second = attemptSignal(undefined, 1000);
    second.cleanup();
    vi.advanceTimersByTime(2000);
    expect(second.signal.aborted).toBe(false);
  });
  it('starts aborted when the caller already aborted', () => {
    const caller = new AbortController();
    caller.abort();
    expect(attemptSignal(caller.signal, 0).signal.aborted).toBe(true);
  });
  it('sleep resolves, or rejects with the abort reason', async () => {
    vi.useFakeTimers();
    const done = sleep(500);
    vi.advanceTimersByTime(500);
    await expect(done).resolves.toBeUndefined();
    const caller = new AbortController();
    const pending = sleep(500, caller.signal);
    caller.abort(new Error('bye'));
    await expect(pending).rejects.toThrow('bye');
  });
});

describe('crypto', () => {
  it('makes v4 UUIDs, also without a global crypto (Node 18)', async () => {
    expect(await randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    vi.stubGlobal('crypto', undefined);
    const webcrypto = await getWebCrypto();
    expect(typeof webcrypto.subtle.importKey).toBe('function');
    expect(await randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('loads Node modules through a variable specifier only', async () => {
    const path = await loadNodeModule<{ basename(p: string): string }>('node:path');
    expect(path.basename('/a/b.png')).toBe('b.png');
    const source = readFileSync(new URL('../src/core/crypto.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/import\(\s*['"]node:/);
  });
});
