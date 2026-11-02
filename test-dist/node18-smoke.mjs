#!/usr/bin/env node
// SS-018 D1: the packed SDK on the oldest supported Node (CI runs it with Node 18 after
// `check:package -- --keep`). No dependencies: require() + import() of the extracted package, a
// retried request through a fake fetch, an upload body, and a webhook vector verified with Web
// Crypto (Node 18 has no global `crypto`, so this exercises the node:crypto fallback).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inputPath } from '../scripts/inputs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consumer = process.argv[2] ?? path.join(ROOT, '.pack/consumer');
const pkgDir = path.join(consumer, 'node_modules/@storeshot/sdk');

const cjs = createRequire(path.join(consumer, 'index.js'))('@storeshot/sdk');
const esm = await import(pathToFileURL(path.join(pkgDir, 'dist/esm/index.js')).href);
assert.equal(typeof cjs.Storeshot, 'function');
assert.equal(esm.SDK_VERSION, cjs.SDK_VERSION);

const calls = [];
const replies = [
  new Response('{"error":{"code":"INTERNAL_ERROR","message":"x","requestId":"r","docUrl":"d"}}', {
    status: 503,
  }),
  new Response('{"data":[],"nextCursor":null}', { status: 200 }),
  new Response('{"id":"u1"}', { status: 201 }),
];
const fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return replies.shift();
};
const client = new esm.Storeshot({ apiKey: 'ss_test_node18smoke', fetch, timeoutMs: 5000 });
const list = await client.generations.list();
assert.deepEqual(list, { data: [], nextCursor: null });
assert.equal(calls.length, 2, 'a 503 GET is retried');
const upload = await client.uploads.create({
  file: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  filename: 'a.png',
});
assert.equal(upload.id, 'u1');
assert.ok(calls[2].init.body instanceof FormData);

const [plain] = JSON.parse(readFileSync(inputPath('webhookVectors'), 'utf8')).vectors;
const payload = Buffer.from(plain.bodyBase64, 'base64');
for (const sdk of [cjs, esm]) {
  assert.equal(
    await sdk.verifyWebhookSignature({
      payload,
      signature: plain.header,
      secret: plain.secrets[0],
      now: plain.timestamp,
    }),
    true,
  );
  assert.equal(
    await sdk.verifyWebhookSignature({
      payload,
      signature: plain.header,
      secret: 'whsec_wrong',
      now: plain.timestamp,
    }),
    false,
  );
}
assert.throws(
  () => new esm.Storeshot({ apiKey: '' }),
  (error) => error instanceof cjs.StoreshotError,
);
console.log(
  `node18 smoke ok ${process.version} (global crypto: ${typeof globalThis.crypto !== 'undefined'})`,
);
