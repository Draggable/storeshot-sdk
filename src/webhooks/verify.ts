import { getWebCrypto } from '../core/crypto.js';
import { StoreshotWebhookError } from '../errors.js';
import type { WebhookEvent } from '../types.js';

/** The header that carries `t=<unix seconds>,v1=<hex>[,v1=<hex>]`. */
export const WEBHOOK_SIGNATURE_HEADER = 'Storeshot-Signature';
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookInput {
  /** The exact request body: bytes, or the received text unchanged (never re-serialised JSON). */
  payload: string | Uint8Array | ArrayBuffer;
  /** The `Storeshot-Signature` header value. */
  signature: string | null | undefined;
  /** The webhook secret (`whsec_…`), or several while you rotate your own configuration. */
  secret: string | readonly string[];
  /** Maximum age (and future skew) of `t`, default 300 seconds. */
  toleranceSeconds?: number;
  /** Current time in Unix seconds (tests). */
  now?: number;
}

const encoder = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/i;

function toBytes(payload: VerifyWebhookInput['payload']): Uint8Array<ArrayBuffer> {
  if (typeof payload === 'string') return encoder.encode(payload);
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload.slice(0));
  return new Uint8Array(payload);
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verifies a Storeshot webhook signature exactly as https://storeshot.art/docs/webhooks/
 * describes: one `t` (digits) within the tolerance, HMAC-SHA256(secret, `<t>.<raw body>`), any
 * `v1` matching (two during a secret rotation), compared in constant time by Web Crypto. Runs on
 * Node ≥ 18, Bun, Deno, edge runtimes and browsers.
 */
export async function verifyWebhookSignature(input: VerifyWebhookInput): Promise<boolean> {
  if (typeof input.signature !== 'string' || input.signature === '') return false;
  const items = input.signature.split(',').map((part) => part.trim().split('='));
  const timestamps = items.filter(([key]) => key === 't').map(([, value]) => value ?? '');
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamps[0])) return false;
  const now = input.now ?? Date.now() / 1000;
  const tolerance = input.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(timestamps[0])) > tolerance) return false;
  const signatures = items
    .filter(([key, value]) => key === 'v1' && HEX64.test(value ?? ''))
    .map(([, value]) => hexBytes(value));
  if (signatures.length === 0) return false;
  const body = toBytes(input.payload);
  const prefix = encoder.encode(`${timestamps[0]}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix, 0);
  signed.set(body, prefix.length);
  const { subtle } = await getWebCrypto();
  const secrets = typeof input.secret === 'string' ? [input.secret] : input.secret;
  for (const secret of secrets) {
    if (!secret) continue;
    const key = await subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    for (const signature of signatures) {
      if (await subtle.verify('HMAC', key, signature, signed)) return true;
    }
  }
  return false;
}

/**
 * Verifies the signature, then parses the event. Throws `StoreshotWebhookError`
 * (`WEBHOOK_SIGNATURE_INVALID` or `WEBHOOK_PAYLOAD_INVALID`). Deduplicate on `event.id`.
 */
export async function constructWebhookEvent(input: VerifyWebhookInput): Promise<WebhookEvent> {
  if (!(await verifyWebhookSignature(input))) {
    throw new StoreshotWebhookError({
      code: 'WEBHOOK_SIGNATURE_INVALID',
      message:
        'The Storeshot-Signature header does not match this payload and secret (or is too old). Verify the raw request body.',
    });
  }
  const text =
    typeof input.payload === 'string'
      ? input.payload
      : new TextDecoder().decode(toBytes(input.payload));
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    event = null;
  }
  if (typeof (event as { type?: unknown } | null)?.type !== 'string') {
    throw new StoreshotWebhookError({
      code: 'WEBHOOK_PAYLOAD_INVALID',
      message: 'The webhook payload is not a JSON event with a type.',
    });
  }
  return event as WebhookEvent;
}
