import { afterEach, describe, expect, it, vi } from 'vitest';
import { Storeshot, StoreshotTimeoutError } from '../src/index.js';
import { json, recordingFetch, rejection, type Reply } from './helpers/recordingFetch.js';

afterEach(() => vi.useRealTimers());

const generation = (status: string) => ({ id: 'g1', status });
const set = (status: string) => ({ id: 's1', status });

/** Replies after `heldMs` of (fake) time, like a server holding a `Prefer: wait` request. */
const held =
  (heldMs: number, body: unknown, status = 202) =>
  (): Promise<Response> =>
    new Promise((resolve) => setTimeout(() => resolve(json(status, body)), heldMs));

function sdk(...replies: Reply[]) {
  const recorded = recordingFetch(...replies);
  return { ...recorded, client: new Storeshot({ apiKey: 'ss_test_k', fetch: recorded.fetch }) };
}

async function run<T>(start: () => Promise<T>): Promise<{ value?: T; error?: any; at: number }> {
  vi.useFakeTimers();
  const began = Date.now();
  const outcome = start().then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.runAllTimersAsync();
  const result = await outcome;
  return { ...result, at: Date.now() - began };
}

describe('waitForGeneration', () => {
  it('long-polls with Prefer: wait until the generation is final', async () => {
    const { client, calls } = sdk(
      held(60_000, generation('running')),
      held(5000, generation('succeeded'), 200),
    );
    const result = await run(() => client.waitForGeneration('g1'));
    expect(result.value).toEqual(generation('succeeded'));
    expect(calls.map((c) => [c.url, c.headers.get('prefer')])).toEqual([
      ['https://api.storeshot.art/v1/generations/g1', 'wait=60'],
      ['https://api.storeshot.art/v1/generations/g1', 'wait=60'],
    ]);
    expect(result.at).toBe(65_000);
  });

  it('returns a final generation without a request, and resolves failed/canceled', async () => {
    const { client, calls } = sdk(json(200, generation('failed')));
    expect(await client.waitForGeneration(generation('succeeded') as never)).toEqual(
      generation('succeeded'),
    );
    expect(calls).toHaveLength(0);
    expect(await client.waitForGeneration(generation('queued') as never)).toEqual(
      generation('failed'),
    );
    const canceled = sdk(json(200, generation('canceled')));
    expect((await canceled.client.waitForGeneration('g1')).status).toBe('canceled');
  });

  it('pauses pollIntervalMs when a busy server answers 202 at once', async () => {
    const { client, calls } = sdk(
      json(202, generation('running')),
      json(202, generation('running')),
      json(200, generation('succeeded')),
    );
    const result = await run(() => client.waitForGeneration('g1', { pollIntervalMs: 3000 }));
    expect(result.value?.status).toBe('succeeded');
    expect(calls).toHaveLength(3);
    expect(result.at).toBe(6000);
  });

  it('asks for the remaining time near the deadline and times out', async () => {
    const { client, calls } = sdk((call) => {
      const seconds = Number(call.headers.get('prefer')?.split('=')[1]);
      return held(seconds * 1000, generation('running'))();
    });
    const result = await run(() => client.waitForGeneration('g1', { timeoutMs: 90_000 }));
    expect(calls.map((c) => c.headers.get('prefer'))).toEqual(['wait=60', 'wait=30']);
    expect(result.error).toBeInstanceOf(StoreshotTimeoutError);
    expect(result.error).toMatchObject({
      code: 'WAIT_TIMEOUT',
      details: { id: 'g1', status: 'running' },
    });
  });

  it('stops on abort', async () => {
    const controller = new AbortController();
    const { client, calls } = sdk(json(202, generation('running')));
    const pending = rejection(client.waitForGeneration('g1', { signal: controller.signal }));
    await new Promise((r) => setTimeout(r, 5));
    controller.abort(new DOMException('stop', 'AbortError'));
    expect((await pending).name).toBe('AbortError');
    const count = calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(count);
  });
});

describe('waitForScreenshotSet', () => {
  it.each(['succeeded', 'partially_failed', 'failed', 'canceled'])(
    'polls until %s',
    async (final) => {
      const { client, calls } = sdk(
        json(200, set('queued')),
        json(200, set('running')),
        json(200, set(final)),
      );
      const result = await run(() => client.waitForScreenshotSet('s1'));
      expect(result.value?.status).toBe(final);
      expect(calls).toHaveLength(3);
      expect(calls.every((c) => c.url === 'https://api.storeshot.art/v1/screenshot-sets/s1')).toBe(
        true,
      );
      expect(calls.some((c) => c.headers.has('prefer'))).toBe(false);
      expect(result.at).toBe(6000);
    },
  );

  it('starts with a pause when given a set object, and times out', async () => {
    const { client, calls } = sdk(json(200, set('running')));
    const result = await run(() =>
      client.waitForScreenshotSet(set('running') as never, {
        timeoutMs: 10_000,
        pollIntervalMs: 4000,
      }),
    );
    expect(result.error).toMatchObject({
      code: 'WAIT_TIMEOUT',
      details: { id: 's1', status: 'running' },
    });
    expect(calls).toHaveLength(3);
    expect(result.at).toBe(10_000);
  });
});
