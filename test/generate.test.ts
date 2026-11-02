import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inputPath } from '../scripts/inputs.mjs';
// @ts-expect-error untyped build script
import { generate } from '../scripts/generate.mjs';
import {
  CONTRACT_VERSION,
  ERROR_CODES,
  OPERATIONS,
  WEBHOOK_EVENT_TYPES,
} from '../src/generated/operations.js';

const spec = JSON.parse(readFileSync(inputPath('contract'), 'utf8'));
const committed = (file: string) =>
  readFileSync(new URL(`../src/generated/${file}`, import.meta.url), 'utf8');

describe('generate (D2)', () => {
  it('is deterministic and matches the committed files', async () => {
    const first = await generate(spec);
    const second = await generate(spec);
    expect(first).toEqual(second);
    expect(first.schema).toBe(committed('schema.ts'));
    expect(first.operations).toBe(committed('operations.ts'));
  });

  it('describes every operation of the contract', () => {
    const ids = Object.values<Record<string, { operationId?: string }>>(spec.paths)
      .flatMap((ops) => Object.values(ops).map((op) => op.operationId))
      .filter(Boolean)
      .sort();
    expect(Object.keys(OPERATIONS)).toEqual(ids);
    expect(ids).toHaveLength(58);
    expect(CONTRACT_VERSION).toBe(spec.info.version);
    expect([...ERROR_CODES]).toEqual(spec.components.schemas.ErrorCode.enum);
    expect([...WEBHOOK_EVENT_TYPES].sort()).toEqual(Object.keys(spec.webhooks).sort());
  });

  it('derives idempotency, wait, body kind and binary answers from the spec', () => {
    const keyed = Object.entries(OPERATIONS)
      .filter(([, op]) => op.idempotencyKey)
      .map(([id]) => id)
      .sort();
    expect(keyed).toEqual([
      'createBillingCheckout',
      'createBillingSubscriptionCheckout',
      'createGeneration',
      'createScreenshotSet',
    ]);
    expect(OPERATIONS.getGeneration).toMatchObject({
      method: 'GET',
      path: '/generations/{id}',
      wait: true,
      pathParams: ['id'],
      body: 'none',
    });
    expect(OPERATIONS.listScreenshotSets.wait).toBe(false);
    expect(OPERATIONS.createUpload.body).toBe('json|multipart');
    expect(OPERATIONS.createGeneration.body).toBe('json');
    expect(OPERATIONS.getScreenshotSetArchive.binary).toBe(true);
    expect(OPERATIONS.getScreenshotSet.binary).toBe(false);
    expect(OPERATIONS.createScreenshotSet.successStatuses).toEqual([200, 202]);
    expect(OPERATIONS.revokeApiKey).toMatchObject({ method: 'DELETE', successStatuses: [204] });
  });
});
