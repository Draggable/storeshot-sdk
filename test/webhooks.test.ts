import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  StoreshotWebhookError,
  WEBHOOK_SIGNATURE_HEADER,
  constructWebhookEvent,
  verifyWebhookSignature,
} from '../src/index.js';
import { pathToFileURL } from 'node:url';
import { inputPath } from '../scripts/inputs.mjs';
import { rejection } from './helpers/recordingFetch.js';

// The published Node verifier of the webhooks guide (https://storeshot.art/docs/webhooks/), plain JS.
const { verifyStoreshotSignature } = (await import(
  pathToFileURL(inputPath('webhookSnippet')).href
)) as {
  verifyStoreshotSignature: (
    rawBody: Uint8Array | string,
    header: string,
    secret: string,
    toleranceSec?: number,
    now?: number,
  ) => boolean;
};

interface Vector {
  name: string;
  secrets: string[];
  timestamp: number;
  bodyBase64: string;
  header: string;
}
const { vectors } = JSON.parse(readFileSync(inputPath('webhookVectors'), 'utf8')) as {
  vectors: Vector[];
};

const bytes = (v: Vector) => new Uint8Array(Buffer.from(v.bodyBase64, 'base64'));
// A secret no vector was signed with (derived, so the fixture stays the only file with whsec_ values).
const OTHER = vectors[0].secrets[0].replace(/^whsec_NEW/, 'whsec_OTH');
const flipT = (header: string, t: number) => header.replace(/^t=\d+/, `t=${t}`);

interface Case {
  name: string;
  payload: Uint8Array | string;
  header: string;
  secret: string;
  now: number;
  expected: boolean;
}

function cases(v: Vector): Case[] {
  const raw = bytes(v);
  const t = v.timestamp;
  const tampered = raw.slice();
  tampered[tampered.length - 2] ^= 1;
  const firstV1 = /v1=([0-9a-f]{64})/.exec(v.header)![1];
  const out: Case[] = [];
  for (const secret of v.secrets) {
    out.push(
      { name: 'bytes', payload: raw, header: v.header, secret, now: t, expected: true },
      {
        name: 'text',
        payload: new TextDecoder().decode(raw),
        header: v.header,
        secret,
        now: t,
        expected: true,
      },
      {
        name: 'now = t + 300',
        payload: raw,
        header: v.header,
        secret,
        now: t + 300,
        expected: true,
      },
      {
        name: 'now = t - 300',
        payload: raw,
        header: v.header,
        secret,
        now: t - 300,
        expected: true,
      },
      {
        name: 'spaces after commas',
        payload: raw,
        header: v.header.split(',').join(', '),
        secret,
        now: t,
        expected: true,
      },
      {
        name: 'uppercase hex',
        payload: raw,
        header: v.header.toUpperCase().replace(/^T=/, 't=').replace(/V1=/g, 'v1='),
        secret,
        now: t,
        expected: true,
      },
      {
        name: 'tampered byte',
        payload: tampered,
        header: v.header,
        secret,
        now: t,
        expected: false,
      },
      {
        name: 'stale t (+301)',
        payload: raw,
        header: v.header,
        secret,
        now: t + 301,
        expected: false,
      },
      {
        name: 'future t (-301)',
        payload: raw,
        header: v.header,
        secret,
        now: t - 301,
        expected: false,
      },
      {
        name: 'other t',
        payload: raw,
        header: flipT(v.header, t + 1),
        secret,
        now: t,
        expected: false,
      },
      {
        name: 't twice',
        payload: raw,
        header: `t=${t},${v.header}`,
        secret,
        now: t,
        expected: false,
      },
      {
        name: 'no t',
        payload: raw,
        header: v.header.replace(/^t=\d+,/, ''),
        secret,
        now: t,
        expected: false,
      },
      {
        name: 'non-digit t',
        payload: raw,
        header: flipT(v.header, 0).replace('t=0', 't=12a'),
        secret,
        now: t,
        expected: false,
      },
      {
        name: 'non-hex v1',
        payload: raw,
        header: `t=${t},v1=${firstV1.slice(0, 63)}z`,
        secret,
        now: t,
        expected: false,
      },
      {
        name: 'truncated v1',
        payload: raw,
        header: `t=${t},v1=${firstV1.slice(0, 62)}`,
        secret,
        now: t,
        expected: false,
      },
      { name: 'empty header', payload: raw, header: '', secret, now: t, expected: false },
    );
  }
  out.push({
    name: 'wrong secret',
    payload: raw,
    header: v.header,
    secret: OTHER,
    now: t,
    expected: false,
  });
  return out;
}

describe('verifyWebhookSignature (D5) on vectors from the server signer', () => {
  for (const vector of vectors) {
    it.each(cases(vector))(`${vector.name}: $name → $expected`, async (c) => {
      const verdict = await verifyWebhookSignature({
        payload: c.payload,
        signature: c.header,
        secret: c.secret,
        now: c.now,
      });
      expect(verdict).toBe(c.expected);
      // Same verdict as the published snippet (the webhooks guide's verify-webhook.mjs).
      const snippet =
        c.header === ''
          ? false
          : verifyStoreshotSignature(Buffer.from(c.payload), c.header, c.secret, 300, c.now);
      expect(snippet).toBe(c.expected);
    });
  }

  it('accepts a list of secrets and refuses a missing header', async () => {
    const rotation = vectors.find((v) => v.name === 'rotation')!;
    const payload = bytes(rotation);
    const now = rotation.timestamp;
    expect(
      await verifyWebhookSignature({
        payload,
        signature: rotation.header,
        secret: [OTHER, rotation.secrets[1]],
        now,
      }),
    ).toBe(true);
    expect(
      await verifyWebhookSignature({
        payload,
        signature: rotation.header,
        secret: [OTHER, ''],
        now,
      }),
    ).toBe(false);
    expect(
      await verifyWebhookSignature({ payload, signature: null, secret: rotation.secrets[0], now }),
    ).toBe(false);
    expect(
      await verifyWebhookSignature({
        payload: payload.buffer,
        signature: rotation.header,
        secret: rotation.secrets[0],
        now,
      }),
    ).toBe(true);
    expect(WEBHOOK_SIGNATURE_HEADER).toBe('Storeshot-Signature');
  });

  it('uses Web Crypto only (no node: import)', () => {
    const source = readFileSync(new URL('../src/webhooks/verify.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]node:|import\(['"]node:/);
  });
});

describe('constructWebhookEvent', () => {
  const plain = vectors.find((v) => v.name === 'plain')!;
  const empty = vectors.find((v) => v.name === 'empty-object')!;

  it('returns the parsed event', async () => {
    const event = await constructWebhookEvent({
      payload: bytes(plain),
      signature: plain.header,
      secret: plain.secrets[0],
      now: plain.timestamp,
    });
    expect(event.type).toBe('generation.succeeded');
    expect(event.id).toBe('evt_0123456789abcdef0123456789abcdef');
  });

  it('throws WEBHOOK_SIGNATURE_INVALID and WEBHOOK_PAYLOAD_INVALID', async () => {
    const bad = await rejection(
      constructWebhookEvent({
        payload: bytes(plain),
        signature: plain.header,
        secret: 'whsec_wrong',
        now: plain.timestamp,
      }),
    );
    expect(bad).toBeInstanceOf(StoreshotWebhookError);
    expect(bad.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    const typeless = await rejection(
      constructWebhookEvent({
        payload: bytes(empty),
        signature: empty.header,
        secret: empty.secrets[0],
        now: empty.timestamp,
      }),
    );
    expect(typeless.code).toBe('WEBHOOK_PAYLOAD_INVALID');
  });
});
