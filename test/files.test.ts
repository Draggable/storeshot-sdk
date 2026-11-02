import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES, toUploadBlob } from '../src/helpers/files.js';
import { Storeshot, StoreshotError } from '../src/index.js';
import { json, recordingFetch, rejection } from './helpers/recordingFetch.js';
import { makeTempDir } from './helpers/tmp.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const tmp = makeTempDir('files');
const pngPath = path.join(tmp.dir, 'home.png');
writeFileSync(pngPath, PNG);

afterAll(() => tmp.remove());
afterEach(() => vi.unstubAllGlobals());

const bytesOf = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];
const streamOf = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

describe('toUploadBlob', () => {
  it('reads a path and names the part after it', async () => {
    const { blob, filename } = await toUploadBlob({ file: pngPath });
    expect(filename).toBe('home.png');
    expect(await bytesOf(blob)).toEqual([...PNG]);
  });

  it.each([
    ['Buffer', () => Buffer.from(PNG)],
    ['Uint8Array', () => PNG],
    ['a Uint8Array view', () => new Uint8Array([9, ...PNG, 9]).subarray(1, PNG.length + 1)],
    ['ArrayBuffer', () => PNG.slice().buffer],
    ['Blob', () => new Blob([PNG])],
    ['ReadableStream', () => streamOf(PNG.slice(0, 3), PNG.slice(3, 8), PNG.slice(8))],
  ])('accepts %s', async (_name, make) => {
    const { blob, filename } = await toUploadBlob({ file: make() });
    expect(filename).toBe('upload');
    expect(await bytesOf(blob)).toEqual([...PNG]);
  });

  it('keeps the given filename and content type', async () => {
    const { blob, filename } = await toUploadBlob({
      file: PNG,
      filename: 'a.png',
      contentType: 'image/png',
    });
    expect(filename).toBe('a.png');
    expect(blob.type).toBe('image/png');
  });

  it('refuses more than 20 MiB before sending anything, and stops reading a stream', async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    expect(await rejection(toUploadBlob({ file: big }))).toMatchObject({ code: 'FILE_TOO_LARGE' });
    let cancelled = false;
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await rejection(toUploadBlob({ file: endless }))).toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(25);
    const bigPath = path.join(tmp.dir, 'big.png');
    writeFileSync(bigPath, big);
    expect(await rejection(toUploadBlob({ file: bigPath }))).toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });

  it('reports a missing file and refuses paths without Node built-ins', async () => {
    expect((await rejection(toUploadBlob({ file: path.join(tmp.dir, 'missing.png') }))).code).toBe(
      'ENOENT',
    );
    vi.stubGlobal('process', { env: {} });
    const error = await rejection(toUploadBlob({ file: pngPath }));
    expect(error).toBeInstanceOf(StoreshotError);
    expect(error.code).toBe('NODE_ONLY');
  });

  it('refuses other values', async () => {
    expect(await rejection(toUploadBlob({ file: 42 as never }))).toMatchObject({
      code: 'INVALID_CONFIGURATION',
    });
  });
});

describe('uploads.create', () => {
  it('sends one multipart part named file', async () => {
    const { fetch, calls } = recordingFetch(json(201, { id: 'u1' }));
    const client = new Storeshot({ apiKey: 'ss_test_k', fetch });
    expect(await client.uploads.create({ file: pngPath })).toEqual({ id: 'u1' });
    const body = calls[0].body as FormData;
    expect([...body.keys()]).toEqual(['file']);
    const part = body.get('file') as File;
    expect(part.name).toBe('home.png');
    expect(await bytesOf(part)).toEqual([...PNG]);
    expect(calls[0].headers.has('content-type')).toBe(false);
  });

  it('imports a URL as JSON', async () => {
    const { fetch, calls } = recordingFetch(json(201, { id: 'u2' }));
    await new Storeshot({ apiKey: 'ss_test_k', fetch }).uploads.create({
      url: 'https://example.com/a.png',
    });
    expect(calls[0].body).toBe('{"url":"https://example.com/a.png"}');
    expect(calls[0].headers.get('content-type')).toBe('application/json');
  });

  it('makes no request when the input is refused', async () => {
    const { fetch, calls } = recordingFetch(json(201, {}));
    const client = new Storeshot({ apiKey: 'ss_test_k', fetch });
    await rejection(client.uploads.create({ file: path.join(tmp.dir, 'missing.png') }));
    await rejection(client.uploads.create({ file: new Uint8Array(MAX_UPLOAD_BYTES + 1) }));
    expect(calls).toHaveLength(0);
  });
});
