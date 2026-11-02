import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Storeshot } from '../src/index.js';
import { envelope, recordingFetch, rejection, type Reply } from './helpers/recordingFetch.js';
import { makeTempDir } from './helpers/tmp.js';

const ZIP = new Uint8Array([0x50, 0x4b, 3, 4, 10, 20, 30]);
const tmp = makeTempDir('archive');
afterAll(() => tmp.remove());

const zip = () =>
  new Response(ZIP, { status: 200, headers: { 'content-type': 'application/zip' } });
const client = (...replies: Reply[]) => {
  const recorded = recordingFetch(...replies);
  return { ...recorded, sdk: new Storeshot({ apiKey: 'ss_test_k', fetch: recorded.fetch }) };
};

describe('screenshot set archives', () => {
  it('archive() returns the bytes (a Buffer on Node) and sends the layout', async () => {
    const { sdk, calls } = client(zip());
    const bytes = await sdk.screenshotSets.archive('s1', { layout: 'fastlane' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect([...bytes]).toEqual([...ZIP]);
    expect(calls[0].url).toBe(
      'https://api.storeshot.art/v1/screenshot-sets/s1/archive?layout=fastlane',
    );
    expect(calls[0].headers.get('accept')).toBe('application/zip');
  });

  it('archiveStream() returns the body stream', async () => {
    const { sdk } = client(zip());
    const stream = await sdk.screenshotSets.archiveStream('s1');
    expect(stream).toBeInstanceOf(ReadableStream);
    expect([...new Uint8Array(await new Response(stream).arrayBuffer())]).toEqual([...ZIP]);
  });

  it('downloadArchive() writes the file through a .part file', async () => {
    const { sdk } = client(zip());
    const target = path.join(tmp.dir, 'listing.zip');
    expect(await sdk.screenshotSets.downloadArchive('s1', target)).toEqual({
      path: target,
      bytes: ZIP.length,
    });
    expect([...readFileSync(target)]).toEqual([...ZIP]);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it('leaves nothing behind when the body fails midway', async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0x50, 0x4b]));
            controller.error(new Error('connection reset'));
          },
        }),
        { status: 200 },
      );
    const { sdk } = client(broken, broken, broken);
    const target = path.join(tmp.dir, 'broken.zip');
    await rejection(sdk.screenshotSets.downloadArchive('s1', target, { maxRetries: 0 }));
    expect(existsSync(target)).toBe(false);
    expect(existsSync(`${target}.part`)).toBe(false);
  });

  it('surfaces 409 SCREENSHOT_SET_STATE_CONFLICT', async () => {
    const { sdk } = client(envelope(409, 'SCREENSHOT_SET_STATE_CONFLICT'));
    expect(await rejection(sdk.screenshotSets.archive('s1'))).toMatchObject({
      status: 409,
      code: 'SCREENSHOT_SET_STATE_CONFLICT',
    });
  });

  it('retries a busy 503 (GET) after Retry-After', async () => {
    const { sdk, calls } = client(
      envelope(503, 'SERVICE_UNAVAILABLE', { 'retry-after': '0' }),
      zip(),
    );
    expect([...(await sdk.screenshotSets.archive('s1'))]).toEqual([...ZIP]);
    expect(calls).toHaveLength(2);
  });

  it('gives downloads a 300 s attempt timeout unless the caller sets one', async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const hang: Reply = (call) =>
        new Promise((_resolve, reject) => {
          signals.push(call.signal as AbortSignal);
          call.signal?.addEventListener('abort', () => reject(call.signal?.reason));
        });
      const { sdk } = client(hang);
      const pending = rejection(sdk.screenshotSets.archive('s1', { maxRetries: 0 }));
      await vi.advanceTimersByTimeAsync(299_999);
      expect(signals[0].aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).code).toBe('TIMEOUT');
      const short = rejection(sdk.screenshotSets.archive('s1', { maxRetries: 0, timeoutMs: 20 }));
      await vi.advanceTimersByTimeAsync(20);
      expect((await short).code).toBe('TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });
});
