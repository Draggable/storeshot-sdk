# @storeshot/sdk

The official TypeScript/JavaScript SDK for the [Storeshot API](https://storeshot.art/docs/): turn raw
app screenshots into App Store and Google Play marketing images. Typed from the API contract
(OpenAPI), zero runtime dependencies, runs on Node ≥ 18, Bun, Deno and edge runtimes.

> **Not on npm yet.** `@storeshot/sdk` has not been published. Until it is, build a tarball from
> this repository with `npm ci && npm run build && npm pack` and install that file
> (`npm install ./storeshot-sdk-<version>.tgz`).

## Install

Once published:

```sh
npm install @storeshot/sdk
```

Until then, install the tarball built from this repository (see the note above).

## API key

The client reads the key from `STORESHOT_API_KEY` (or the `apiKey` option). Create one in the
developer console (https://console.storeshot.art/):

- `ss_test_…` keys are free: everything works, but the images are sample images and no credits
  are used. Start with one.
- `ss_live_…` keys make real images and spend credits (1 per image).

Never print, log or commit a key, never paste it into a chat, and never ship it to a browser: call
the API from your server or build script. The SDK never logs the key and masks it in `toString()`,
`JSON.stringify()`, `console.log()` and error messages.

No key yet? A tool can get one with its human's approval (device authorization, RFC 8628): a
client created with `apiKey: null` can call only `client.auth.*`. `linkAccount` shows your human a
console link and a code through `onCode`, waits for the approval and returns the new key once:

```ts
const linked = await new Storeshot({ apiKey: null }).auth.linkAccount({
  clientName: 'my-tool',
  onCode: ({ verificationUriComplete, userCode }) =>
    console.log(`Open ${verificationUriComplete} and confirm the code ${userCode}.`),
});
// Store linked.apiKey in your secret store (never print it), then:
const client = new Storeshot({ apiKey: linked.apiKey });
```

It throws `StoreshotError` `DEVICE_ACCESS_DENIED` or `DEVICE_CODE_EXPIRED` when the human denies
the request or does not answer within 10 minutes.

## Quick start

From one raw screenshot (`home.png`) to an App Store listing in fastlane's folder layout:

<!-- sdk-readme-example -->

```ts
import { Storeshot } from '@storeshot/sdk';

const storeshot = new Storeshot(); // reads STORESHOT_API_KEY
const upload = await storeshot.uploads.create({ file: './home.png' });
const set = await storeshot.screenshotSets.create({
  app: { name: 'Trailmate' },
  screens: [{ input: { uploadId: upload.id }, caption: 'Find every trail' }],
  stores: [{ store: 'app_store' }],
});
const done = await storeshot.waitForScreenshotSet(set);
console.log(done.status, `${done.counts.succeeded}/${done.images} images`);
await storeshot.screenshotSets.downloadArchive(done.id, 'listing.zip', { layout: 'fastlane' });
```

Unzip `listing.zip` in your project root: fastlane `deliver` reads `fastlane/screenshots/`.
With a live key, ask for the price first: `await storeshot.screenshotSets.quote(body)` returns
`images`, `credits` and `sufficient` and creates nothing. For a single image use
`storeshot.generations.create({ inputs: [{ uploadId }], store: 'app_store', device:
'app_store_1290x2796', app: { name: 'Trailmate' } })`; `storeshot.devices.list()` lists the sizes.

## Waiting

Generations and screenshot sets are asynchronous: a create returns `queued` at once.

```ts
const generation = await storeshot.waitForGeneration(created); // or its id
if (generation.status === 'succeeded') console.log(generation.result?.image.url);

const set = await storeshot.waitForScreenshotSet(setId, { timeoutMs: 15 * 60_000 });
```

- `waitForGeneration` long-polls with `Prefer: wait` (the server holds each request up to 60 s).
- `waitForScreenshotSet` polls every 3 s (`pollIntervalMs`).
- Both resolve with the final resource, also when it `failed`, was `canceled` or (sets)
  `partially_failed`: check `status`. They throw `StoreshotTimeoutError` (`WAIT_TIMEOUT`) after
  `timeoutMs` (default 10 minutes) and stop when `signal` aborts.
- Prefer webhooks (below) for long-running work in servers.

## Uploads

```ts
await storeshot.uploads.create({ file: './screens/home.png' }); // a path (Node, Bun, Deno)
await storeshot.uploads.create({ file: buffer, filename: 'home.png' }); // Buffer / Uint8Array / ArrayBuffer
await storeshot.uploads.create({ file: blob }); // Blob or File
await storeshot.uploads.create({ file: readableStream }); // ReadableStream<Uint8Array>
await storeshot.uploads.create({ url: 'https://example.com/home.png' }); // the server fetches it
```

PNG, JPEG or WebP, at most 20 MiB (checked before anything is sent) and 50 megapixels. Uploads are
deleted after 30 days. Reference an upload by `id` in generations and sets of the same key
environment (test or live).

## Downloads

```ts
const zip = await storeshot.screenshotSets.archive(setId); // Uint8Array (a Buffer on Node)
const stream = await storeshot.screenshotSets.archiveStream(setId); // ReadableStream
await storeshot.screenshotSets.downloadArchive(setId, 'listing.zip', { layout: 'fastlane' });
```

`downloadArchive` writes `listing.zip.part` and renames it when complete, so a failed download
never leaves a partial file. Image URLs in `generation.result` are signed for 15 minutes: get the
generation again for fresh ones.

## Errors

Every failure is a `StoreshotError` (subclasses `StoreshotConnectionError`,
`StoreshotTimeoutError`, `StoreshotWebhookError`):

```ts
import { Storeshot, StoreshotError } from '@storeshot/sdk';

try {
  await storeshot.screenshotSets.create(body);
} catch (error) {
  if (error instanceof StoreshotError && error.code === 'INSUFFICIENT_CREDITS') {
    console.error(`Not enough credits: top up at ${error.details?.topUpUrl}`);
  } else {
    throw error;
  }
}
```

| Field               | Meaning                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`            | HTTP status (0 when there was no response)                                                                                                                                  |
| `code`              | API error code (`ERROR_CODES`, e.g. `INVALID_INPUT`, `RATE_LIMITED`) or an SDK code (`CONNECTION_ERROR`, `TIMEOUT`, `WAIT_TIMEOUT`, `MISSING_API_KEY`, `FILE_TOO_LARGE`, …) |
| `message`           | Human-readable, safe to show                                                                                                                                                |
| `requestId`         | Quote it when asking support@storeshot.art for help                                                                                                                         |
| `details`           | Code-specific data (`topUpUrl`, `requiredCredits`, `issues`, …)                                                                                                             |
| `docUrl`            | Documentation of the code                                                                                                                                                   |
| `retryAfterSeconds` | From `Retry-After` (429 and busy 503 answers)                                                                                                                               |

## Retries and timeouts

- Each attempt times out after `timeoutMs` (default 60 s; archive downloads 300 s).
- `maxRetries` (default 2) retries with capped exponential backoff and jitter:
  - `429` and busy `503` answers with `Retry-After`, for every request: the server refused them
    before doing anything. A `Retry-After` longer than `maxRetryAfterMs` (default 60 s, e.g. the
    daily generation cap) is not waited for: you get the error with `retryAfterSeconds`.
  - Other `5xx`, network errors and timeouts only where repeating is safe: `GET`, creates sent
    with an `Idempotency-Key`, quotes and palettes. Other writes (uploads, webhooks, projects,
    deletes, …) are never repeated blindly; the error says the request may have been processed.
- Per call: `{ signal, timeoutMs, maxRetries, requestId, headers, onResponse }`.
- `onResponse` (client option or per call) receives `requestId`, `rateLimit`,
  `rateLimitPolicy`, `idempotentReplayed` and the headers of every response.

## Idempotency

`generations.create`, `screenshotSets.create`, `billing.createCheckout` and
`billing.createSubscriptionCheckout` always send an `Idempotency-Key`: a new UUID per call,
reused across that call's retries, so a retry never creates or charges twice. To make re-running a
script safe too, pass your own stable key:

```ts
await storeshot.screenshotSets.create(body, { idempotencyKey: 'trailmate-release-2.4' });
```

The same key with the same body returns the original resource; with a different body it is
`409 IDEMPOTENCY_CONFLICT`.

## Webhooks

Register an `https://` endpoint with `storeshot.webhooks.create({ url, events })` (the secret
`whsec_…` is returned once), then verify every delivery against the **raw** body:

```js
import express from 'express';
import { constructWebhookEvent } from '@storeshot/sdk';

const app = express();
app.post('/hooks/storeshot', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const event = await constructWebhookEvent({
      payload: req.body, // the raw bytes, not parsed JSON
      signature: req.get('Storeshot-Signature'),
      secret: process.env.STORESHOT_WEBHOOK_SECRET,
    });
    // Deduplicate on event.id, then handle event.type / event.data.
    res.sendStatus(204);
  } catch {
    res.sendStatus(400);
  }
});
```

On an edge runtime (Web Crypto only):

```ts
import { verifyWebhookSignature } from '@storeshot/sdk';

export default {
  async fetch(request: Request, env: { STORESHOT_WEBHOOK_SECRET: string }) {
    const payload = await request.arrayBuffer();
    const valid = await verifyWebhookSignature({
      payload,
      signature: request.headers.get('Storeshot-Signature'),
      secret: env.STORESHOT_WEBHOOK_SECRET,
    });
    return new Response(null, { status: valid ? 204 : 400 });
  },
};
```

The rules ([webhooks guide](https://storeshot.art/docs/webhooks/)): `v1` is HMAC-SHA256 over `<t>.<raw body>`, any `v1` may match
(two during a secret rotation), compared in constant time; `t` must be within 5 minutes
(`toleranceSeconds`). Pass `secret: [newSecret, oldSecret]` while you roll your own config.

## Test mode

With an `ss_test_…` key everything works like live (validation, uploads, queue, statuses,
idempotency, archives, webhooks to test webhooks) but no credits are used and no image model runs:
each result is a sample image of exactly the requested size. Test results are deleted after 30
days. Test and live are separate: a test key only sees test uploads, generations and webhooks.
`await storeshot.me()` reports `credential.environment`.

## Runtimes

- **Node ≥ 18, Bun, Deno**: everything. File paths (`uploads.create({ file: path })`,
  `downloadArchive`) need one of these.
- **Edge runtimes** (Cloudflare Workers, Vercel Edge, Deno Deploy): everything except file paths;
  pass the key explicitly: `new Storeshot({ apiKey: env.STORESHOT_API_KEY })`.
- **Browsers**: refused by default (`BROWSER_NOT_ALLOWED`), because every visitor could read the
  key. `dangerouslyAllowBrowser: true` exists for internal tools only.
- ESM (`import`) and CommonJS (`require`) builds, TypeScript declarations included, no
  runtime dependencies. `instanceof StoreshotError` works across both builds.
- Other options: `baseUrl` (or `STORESHOT_BASE_URL`; `https:`, or `http:` on localhost),
  `fetch`, `defaultHeaders`, and `client: { surface, name }` to label your tool's usage
  (`X-Storeshot-Client`, default `api/storeshot-sdk-js@<version>`).

## Method reference

Every API operation has exactly one method (types: `Schemas['…']` and the named exports such as
`Generation`, `ScreenshotSet`, `Upload`). Every method takes per-call options last.

| Method                               | Endpoint                              | Notes                |
| ------------------------------------ | ------------------------------------- | -------------------- |
| `activity.list`                      | `GET /activity`                       |                      |
| `apiKeys.create`                     | `POST /api-keys`                      |                      |
| `apiKeys.list`                       | `GET /api-keys`                       |                      |
| `apiKeys.revoke`                     | `DELETE /api-keys/{id}`               |                      |
| `auth.linkAccount`                   | `POST /auth/device/token`             | whole device flow    |
| `auth.pollDeviceToken`               | `POST /auth/device/token`             | no API key needed    |
| `auth.startDeviceAuthorization`      | `POST /auth/device`                   | no API key needed    |
| `billing.cancelSubscription`         | `POST /billing/subscription/cancel`   |                      |
| `billing.changeSubscription`         | `POST /billing/subscription/change`   |                      |
| `billing.createCheckout`             | `POST /billing/checkout`              | auto Idempotency-Key |
| `billing.createPortalSession`        | `POST /billing/portal`                |                      |
| `billing.createSubscriptionCheckout` | `POST /billing/subscription/checkout` | auto Idempotency-Key |
| `billing.getCheckout`                | `GET /billing/checkouts/{id}`         |                      |
| `billing.getSubscription`            | `GET /billing/subscription`           |                      |
| `billing.listPacks`                  | `GET /billing/packs`                  |                      |
| `billing.listPlans`                  | `GET /billing/plans`                  |                      |
| `billing.uncancelSubscription`       | `POST /billing/subscription/uncancel` |                      |
| `credits.get`                        | `GET /credits`                        |                      |
| `devices.list`                       | `GET /devices`                        |                      |
| `generations.cancel`                 | `POST /generations/{id}/cancel`       |                      |
| `generations.create`                 | `POST /generations`                   | auto Idempotency-Key |
| `generations.delete`                 | `DELETE /generations/{id}`            |                      |
| `generations.get`                    | `GET /generations/{id}`               |                      |
| `generations.list`                   | `GET /generations`                    |                      |
| `health`                             | `GET /health`                         |                      |
| `me`                                 | `GET /me`                             |                      |
| `palettes.create`                    | `POST /palettes`                      |                      |
| `projects.addItems`                  | `POST /projects/{id}/items`           |                      |
| `projects.create`                    | `POST /projects`                      |                      |
| `projects.delete`                    | `DELETE /projects/{id}`               |                      |
| `projects.get`                       | `GET /projects/{id}`                  |                      |
| `projects.list`                      | `GET /projects`                       |                      |
| `projects.removeItems`               | `POST /projects/{id}/items/remove`    |                      |
| `projects.update`                    | `PATCH /projects/{id}`                |                      |
| `screenshotSets.archive`             | `GET /screenshot-sets/{id}/archive`   |                      |
| `screenshotSets.archiveStream`       | `GET /screenshot-sets/{id}/archive`   |                      |
| `screenshotSets.cancel`              | `POST /screenshot-sets/{id}/cancel`   |                      |
| `screenshotSets.create`              | `POST /screenshot-sets`               | auto Idempotency-Key |
| `screenshotSets.delete`              | `DELETE /screenshot-sets/{id}`        |                      |
| `screenshotSets.downloadArchive`     | `GET /screenshot-sets/{id}/archive`   |                      |
| `screenshotSets.get`                 | `GET /screenshot-sets/{id}`           |                      |
| `screenshotSets.list`                | `GET /screenshot-sets`                |                      |
| `screenshotSets.quote`               | `POST /screenshot-sets`               |                      |
| `screenshotSets.retry`               | `POST /screenshot-sets/{id}/retry`    |                      |
| `status`                             | `GET /status`                         |                      |
| `stores.list`                        | `GET /stores`                         |                      |
| `stores.requirements`                | `GET /stores/{store}/requirements`    |                      |
| `uploads.complete`                   | `POST /uploads/{id}/complete`         |                      |
| `uploads.create`                     | `POST /uploads`                       |                      |
| `uploads.delete`                     | `DELETE /uploads/{id}`                |                      |
| `uploads.get`                        | `GET /uploads/{id}`                   |                      |
| `uploads.list`                       | `GET /uploads`                        |                      |
| `uploads.presign`                    | `POST /uploads/presign`               |                      |
| `usage.get`                          | `GET /usage`                          |                      |
| `waitForGeneration`                  | `GET /generations/{id}`               |                      |
| `waitForScreenshotSet`               | `GET /screenshot-sets/{id}`           |                      |
| `webhooks.create`                    | `POST /webhooks`                      |                      |
| `webhooks.delete`                    | `DELETE /webhooks/{id}`               |                      |
| `webhooks.get`                       | `GET /webhooks/{id}`                  |                      |
| `webhooks.list`                      | `GET /webhooks`                       |                      |
| `webhooks.listDeliveries`            | `GET /webhooks/{id}/deliveries`       |                      |
| `webhooks.rotateSecret`              | `POST /webhooks/{id}/rotate-secret`   |                      |
| `webhooks.test`                      | `POST /webhooks/{id}/test`            |                      |
| `webhooks.update`                    | `PATCH /webhooks/{id}`                |                      |

## Versioning

`SDK_VERSION` is the package version; it moves with the Storeshot release train. `CONTRACT_VERSION`
is the API contract the types were generated from (`info.version` of the OpenAPI document, today
1.17.0); the API only changes additively within a major version, so a newer API keeps working with
this SDK. See `CHANGELOG.md`.

Licensed under the Apache License 2.0 (`LICENSE`, `NOTICE`).

## Source of truth

This repository is generated from the Storeshot monorepo, where the SDK is developed together
with the API it calls. Every Storeshot release that changes the SDK or the API contract replaces
the contents of this repository with one commit tagged `vX.Y.Z`.

Issues and pull requests are welcome here. Accepted changes are applied upstream and arrive with
the next release, so a pull request is closed rather than merged.

The package is not on npm yet. `.github/workflows/publish.yml` publishes it (with npm provenance)
once it is switched on.

### Development and tests

```sh
npm ci
npm run generate -- --check   # src/generated matches contract/openapi.json
npm run typecheck
npm test
npm run build
npm run check:package         # the package exactly as npm would publish it
```

`contract/openapi.json` is the Storeshot API contract the types are generated from (the API
serves it at https://api.storeshot.art/v1/openapi.json). `test/fixtures/webhook-signature-vectors.json`
holds **fake `whsec_…` webhook secrets**: test vectors for the signature checks, not credentials.
