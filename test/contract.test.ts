import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { inputPath } from '../scripts/inputs.mjs';
import { EXTRA_METHODS, OPERATION_MAP } from '../src/operationMap.js';
import {
  CONTRACT_VERSION,
  ERROR_CODES,
  SDK_ERROR_CODES,
  Storeshot,
  WEBHOOK_EVENT_TYPES,
  type OperationId,
  type WebhookEvent,
} from '../src/index.js';
import { OPERATIONS } from '../src/generated/operations.js';
import { CALLS, ID } from './fixtures/operationCalls.js';
import { recordingFetch } from './helpers/recordingFetch.js';

interface SpecOperation {
  operationId?: string;
  parameters?: { in: string; name: string }[];
  requestBody?: { content: Record<string, unknown> };
  responses: Record<string, { content?: Record<string, unknown> }>;
}

const spec = JSON.parse(readFileSync(inputPath('contract'), 'utf8')) as {
  info: { version: string };
  paths: Record<string, Record<string, SpecOperation>>;
  webhooks: Record<string, unknown>;
  components: { schemas: Record<string, { enum?: string[] }> };
};

const specOps = Object.entries(spec.paths).flatMap(([path, ops]) =>
  Object.entries(ops)
    .filter(([, op]) => op.operationId)
    .map(([method, op]) => ({
      id: op.operationId as OperationId,
      method: method.toUpperCase(),
      path,
      op,
    })),
);

/** A 2xx answer shaped like the operation's first success response. */
function okFor(op: SpecOperation): Response {
  const status = Number(Object.keys(op.responses).find((s) => /^2\d\d$/.test(s)));
  const content = Object.keys(op.responses[String(status)].content ?? {});
  if (status === 204 || content.length === 0) return new Response(null, { status });
  if (content[0] === 'application/zip') return new Response('PK\u0003\u0004', { status });
  return new Response('{"status":"succeeded"}', {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const methodAt = (client: Storeshot, path: string) =>
  path
    .split('.')
    .reduce<unknown>((value, key) => (value as Record<string, unknown>)?.[key], client);

const ANONYMOUS_OPERATIONS = new Set(['createDeviceAuthorization', 'createDeviceToken']);

describe('contract coverage (D2, spec §10)', () => {
  it('maps every operation of the contract to a client method or a reasoned exclusion', () => {
    expect(Object.keys(OPERATION_MAP).sort()).toEqual(specOps.map((o) => o.id).sort());
    expect(Object.keys(OPERATIONS).sort()).toEqual(specOps.map((o) => o.id).sort());
    const client = new Storeshot({ apiKey: 'ss_test_k' });
    for (const [id, target] of Object.entries(OPERATION_MAP) as [string, unknown][]) {
      if (typeof target === 'string') expect(typeof methodAt(client, target), id).toBe('function');
      else expect((target as { excluded: string }).excluded.trim().length, id).toBeGreaterThan(10);
    }
    for (const [method, id] of Object.entries(EXTRA_METHODS)) {
      expect(typeof methodAt(client, method), method).toBe('function');
      expect(OPERATIONS[id]).toBeDefined();
    }
  });

  it.each(specOps)(
    '$id is reachable with the right method, path, query and headers',
    async ({ id, method, path, op }) => {
      const { fetch, calls } = recordingFetch(() => okFor(op));
      const client = new Storeshot({ apiKey: 'ss_test_k', baseUrl: 'https://api.test/v1', fetch });
      await CALLS[id](client);
      expect(calls).toHaveLength(1);
      const call = calls[0];
      const url = new URL(call.url);
      expect(call.method).toBe(method);
      expect(url.pathname).toBe(
        `/v1${path.replace(/\{[^}]+\}/g, path.includes('{store}') ? 'google_play' : ID)}`,
      );
      const declaredQuery = new Set(
        (op.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
      );
      for (const key of url.searchParams.keys())
        expect(declaredQuery.has(key), `${id} ?${key}`).toBe(true);
      const keyed = (op.parameters ?? []).some(
        (p) => p.in === 'header' && p.name === 'idempotency-key',
      );
      expect(call.headers.has('idempotency-key'), `${id} Idempotency-Key`).toBe(keyed);
      const bodyTypes = Object.keys(op.requestBody?.content ?? {});
      if (bodyTypes.length === 0) {
        expect(call.body, `${id} has no body`).toBeUndefined();
      } else if (call.body instanceof FormData) {
        expect(bodyTypes).toContain('multipart/form-data');
        expect([...call.body.keys()]).toEqual(['file']);
      } else {
        expect(bodyTypes).toContain('application/json');
        expect(call.headers.get('content-type')).toBe('application/json');
        expect(() => JSON.parse(String(call.body))).not.toThrow();
      }
      // SS-019: the two device authorization operations are anonymous (no credential sent).
      expect(call.headers.get('authorization')).toBe(
        ANONYMOUS_OPERATIONS.has(id) ? null : 'Bearer ss_test_k',
      );
      expect(call.headers.get('x-storeshot-client')).toMatch(/^api\/storeshot-sdk-js@/);
    },
  );

  it('quote adds dryRun=true and never sends an Idempotency-Key', async () => {
    const { fetch, calls } = recordingFetch(new Response('{"dryRun":true}', { status: 200 }));
    const client = new Storeshot({ apiKey: 'ss_test_k', fetch });
    await client.screenshotSets.quote({
      app: { name: 'T' },
      screens: [{ input: { uploadId: ID }, caption: 'c' }],
      stores: [{ store: 'app_store' }],
    });
    expect(new URL(calls[0].url).search).toBe('?dryRun=true');
    expect(calls[0].headers.has('idempotency-key')).toBe(false);
  });

  it('pins the contract version, error codes and webhook events', () => {
    expect(CONTRACT_VERSION).toBe(spec.info.version);
    expect([...ERROR_CODES]).toEqual(spec.components.schemas.ErrorCode.enum);
    expect(SDK_ERROR_CODES.filter((c) => (ERROR_CODES as readonly string[]).includes(c))).toEqual(
      [],
    );
    expect([...WEBHOOK_EVENT_TYPES].sort()).toEqual(Object.keys(spec.webhooks).sort());
    expectTypeOf<WebhookEvent['type']>().toEqualTypeOf<(typeof WEBHOOK_EVENT_TYPES)[number]>();
  });
});
