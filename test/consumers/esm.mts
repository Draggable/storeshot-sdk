// SS-018 consumer fixture (module: nodenext, ESM, Node types, lib ES2022): typechecked against
// the packed package by scripts/check-package.mjs.
import Storeshot, { StoreshotError, verifyWebhookSignature, type Generation } from '@storeshot/sdk';

const client = new Storeshot({ apiKey: 'ss_test_x' });
const generation: Generation = await client.generations.create(
  {
    inputs: [{ uploadId: 'u' }],
    store: 'app_store',
    device: 'app_store_1290x2796',
    app: { name: 'T' },
  },
  { idempotencyKey: 'k', wait: 30 },
);
console.log(generation.status);
// @ts-expect-error a typo in a response field is a compile error
console.log(generation.statsu);
await client.uploads.create({ file: Buffer.from([1, 2, 3]) });
try {
  await client.me();
} catch (error) {
  if (error instanceof StoreshotError) console.log(error.code, error.requestId);
}
console.log(
  await verifyWebhookSignature({ payload: '{}', signature: 't=1,v1=00', secret: 'whsec_x' }),
);
