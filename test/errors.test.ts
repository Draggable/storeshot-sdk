import { describe, expect, it } from 'vitest';
import { maskKey, scrub, scrubValue } from '../src/core/redact.js';
import { parseRetryAfter } from '../src/core/retryAfter.js';
import {
  SDK_ERROR_CODES,
  StoreshotConnectionError,
  StoreshotError,
  StoreshotTimeoutError,
  StoreshotWebhookError,
  errorFromResponse,
} from '../src/errors.js';
import { ERROR_CODES } from '../src/generated/operations.js';

const KEY = 'ss_test_SECRETsecretSECRET123';
const envelope = {
  error: {
    code: 'NOT_FOUND',
    message: 'Generation not found.',
    requestId: 'req_1',
    docUrl: 'https://storeshot.art/docs/errors/#not_found',
    details: { id: 'x' },
  },
};

describe('errorFromResponse', () => {
  it('maps the ErrorEnvelope', () => {
    const error = errorFromResponse({
      status: 404,
      body: envelope,
      headers: new Headers({ 'x-request-id': 'header-id' }),
      operationId: 'getGeneration',
    });
    expect(error).toBeInstanceOf(StoreshotError);
    expect(error).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Generation not found.',
      requestId: 'req_1',
      docUrl: 'https://storeshot.art/docs/errors/#not_found',
      details: { id: 'x' },
      operationId: 'getGeneration',
      retryAfterSeconds: null,
      name: 'StoreshotError',
    });
    expect(String(error)).toBe(
      'StoreshotError [404 NOT_FOUND]: Generation not found. (request req_1)',
    );
  });

  it('reports a non-envelope body as UNEXPECTED_RESPONSE with the header request id', () => {
    const error = errorFromResponse({
      status: 502,
      body: '<html>bad gateway</html>',
      headers: new Headers({ 'x-request-id': 'edge-1' }),
      operationId: null,
    });
    expect(error).toMatchObject({ status: 502, code: 'UNEXPECTED_RESPONSE', requestId: 'edge-1' });
  });

  it('reads Retry-After as seconds', () => {
    const headers = new Headers({ 'retry-after': '7' });
    const error = errorFromResponse({ status: 429, body: envelope, headers, operationId: null });
    expect(error.retryAfterSeconds).toBe(7);
  });

  it('scrubs keys from messages and details', () => {
    const error = errorFromResponse({
      status: 400,
      body: {
        error: {
          ...envelope.error,
          message: `bad ${KEY} and ss_live_abcdefgh123`,
          details: { nested: [{ value: KEY }] },
        },
      },
      headers: new Headers(),
      operationId: null,
      secrets: [KEY],
    });
    expect(error.message).toBe('bad [redacted] and ss_live_[redacted]');
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error.details)).toBe('{"nested":[{"value":"[redacted]"}]}');
  });
});

describe('error classes', () => {
  it('brands instances so instanceof works across package copies', () => {
    const foreign = Object.assign(new Error('x'), {
      [Symbol.for('storeshot.sdk.error.StoreshotError')]: true,
      [Symbol.for('storeshot.sdk.error.StoreshotTimeoutError')]: true,
    });
    expect(foreign).toBeInstanceOf(StoreshotError);
    expect(foreign).toBeInstanceOf(StoreshotTimeoutError);
    expect(foreign).not.toBeInstanceOf(StoreshotConnectionError);
    expect(new Error('plain')).not.toBeInstanceOf(StoreshotError);
    expect(null).not.toBeInstanceOf(StoreshotError);
  });

  it('keeps the subclass hierarchy', () => {
    for (const Kind of [StoreshotConnectionError, StoreshotTimeoutError, StoreshotWebhookError]) {
      const error = new Kind({ code: 'TIMEOUT', message: 'm' });
      expect(error).toBeInstanceOf(StoreshotError);
      expect(error).toBeInstanceOf(Kind);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(Kind.kind);
      expect(error.status).toBe(0);
    }
    expect(new StoreshotError({ code: 'TIMEOUT', message: 'm' })).not.toBeInstanceOf(
      StoreshotTimeoutError,
    );
  });

  it('never reuses an API error code', () => {
    const overlap = SDK_ERROR_CODES.filter((code) =>
      (ERROR_CODES as readonly string[]).includes(code),
    );
    expect(overlap).toEqual([]);
  });
});

describe('redaction helpers', () => {
  it('masks keys to their environment prefix', () => {
    expect(maskKey(KEY)).toBe('ss_test_…');
    expect(maskKey('ss_live_abc')).toBe('ss_live_…');
    expect(maskKey('eyJhbGciOi.jwt.token')).toBe('…');
  });
  it('scrubs strings and nested values', () => {
    expect(scrub(`x ${KEY} y`, [KEY])).toBe('x [redacted] y');
    expect(scrub('ss_test_short')).toBe('ss_test_short');
    expect(scrubValue({ a: [`k=${KEY}`], n: 1 }, [])).toEqual({
      a: ['k=ss_test_[redacted]'],
      n: 1,
    });
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    const now = Date.parse('2026-11-02T12:00:00Z');
    expect(parseRetryAfter('Mon, 02 Nov 2026 12:00:10 GMT', now)).toBe(10_000);
    expect(parseRetryAfter('Mon, 02 Nov 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('-1')).toBeNull();
    expect(parseRetryAfter('x')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});
