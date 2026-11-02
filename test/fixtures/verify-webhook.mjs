// docs/api/snippets/verify-webhook.mjs (Node ≥ 18, imported verbatim by the tests)
// rawBody: the exact request bytes (Buffer or string), before any JSON parsing.
import { createHmac, timingSafeEqual } from 'node:crypto';
export function verifyStoreshotSignature(rawBody, header, secret, toleranceSec = 300, now = Date.now() / 1000) {
  const items = header.split(',').map((p) => p.trim().split('='));
  const ts = items.filter(([k]) => k === 't').map(([, v]) => v);
  if (ts.length !== 1 || !/^\d+$/.test(ts[0]) || Math.abs(now - Number(ts[0])) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${ts[0]}.`).update(rawBody).digest();
  return items.some(([k, v]) => {
    if (k !== 'v1') return false;
    const got = Buffer.from(v ?? '', 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
