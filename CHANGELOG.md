# Changelog

## Unreleased — first version (contract 1.17.0)

Not published to npm yet; this heading takes the first published version.

- Typed client for every operation of the Storeshot API contract 1.17.0 (58 operations), with
  types generated from the OpenAPI document.
- Typed errors (`StoreshotError` and subclasses) from the API error envelope; the API key is never
  logged or shown.
- Retries with capped exponential backoff and jitter: 429 and busy 503 after `Retry-After`; other
  5xx, network errors and timeouts only where repeating is safe. Per-attempt timeouts and
  `AbortSignal` support.
- Automatic `Idempotency-Key` on generation, screenshot set and checkout creates.
- `waitForGeneration` (long polling with `Prefer: wait`) and `waitForScreenshotSet`.
- Uploads from a file path, bytes, a Blob or a stream; archive downloads to bytes, a stream or a
  file.
- `verifyWebhookSignature` / `constructWebhookEvent` (Web Crypto, edge-ready).
- `client.auth.linkAccount()`: device authorization (RFC 8628) gets an API key with your human's
  approval; a client created with `apiKey: null` needs no key for it.
- ESM and CommonJS builds with TypeScript declarations, zero runtime dependencies, Node ≥ 18.
- Apache License 2.0.
