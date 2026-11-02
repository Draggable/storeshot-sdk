/** Storeshot API keys anywhere in a text (the secret part is at least 8 characters). */
const KEY_PATTERN = /\bss_(live|test)_[A-Za-z0-9_-]{8,}/g;
const MAX_DEPTH = 8;

/** Removes the given secrets and anything shaped like an API key from a text. */
export function scrub(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('[redacted]');
  }
  return out.replace(KEY_PATTERN, (_match, env: string) => `ss_${env}_[redacted]`);
}

/** `scrub` applied to every string of a JSON-like value (error details). */
export function scrubValue(value: unknown, secrets: readonly string[] = [], depth = 0): unknown {
  if (typeof value === 'string') return scrub(value, secrets);
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, secrets, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scrubValue(item, secrets, depth + 1)]),
  );
}

/** What may be shown of a credential: the key environment prefix only. */
export function maskKey(key: string): string {
  const match = /^ss_(live|test)_/.exec(key);
  return match ? `${match[0]}…` : '…';
}
