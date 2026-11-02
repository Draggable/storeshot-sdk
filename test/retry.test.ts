import { describe, expect, it } from 'vitest';
import { backoffMs, decideRetry, type RetryInput } from '../src/core/retry.js';

const base = { attempt: 0, maxRetries: 2, maxRetryAfterMs: 60_000, random: () => 0 };
const input = (
  over: Partial<RetryInput> & Pick<RetryInput, 'retrySafe' | 'outcome'>,
): RetryInput => ({
  ...base,
  ...over,
});

describe('decideRetry (spec §8)', () => {
  const cases: Array<[string, RetryInput, boolean]> = [
    [
      '429, plain POST',
      input({ retrySafe: false, outcome: { kind: 'status', status: 429, retryAfterMs: 2000 } }),
      true,
    ],
    [
      '429 without Retry-After, DELETE',
      input({ retrySafe: false, outcome: { kind: 'status', status: 429 } }),
      true,
    ],
    [
      '503 SERVICE_UNAVAILABLE + Retry-After, PATCH',
      input({
        retrySafe: false,
        outcome: { kind: 'status', status: 503, code: 'SERVICE_UNAVAILABLE', retryAfterMs: 1000 },
      }),
      true,
    ],
    [
      '503 BILLING_UNAVAILABLE + Retry-After, plain POST',
      input({
        retrySafe: false,
        outcome: { kind: 'status', status: 503, code: 'BILLING_UNAVAILABLE', retryAfterMs: 30_000 },
      }),
      true,
    ],
    [
      '503 without Retry-After, plain POST',
      input({
        retrySafe: false,
        outcome: { kind: 'status', status: 503, code: 'SERVICE_UNAVAILABLE' },
      }),
      false,
    ],
    [
      '503 + Retry-After but not an envelope, plain POST',
      input({
        retrySafe: false,
        outcome: { kind: 'status', status: 503, code: null, retryAfterMs: 1000 },
      }),
      false,
    ],
    ['500 GET', input({ retrySafe: true, outcome: { kind: 'status', status: 500 } }), true],
    ['504 keyed POST', input({ retrySafe: true, outcome: { kind: 'status', status: 504 } }), true],
    ['500 DELETE', input({ retrySafe: false, outcome: { kind: 'status', status: 500 } }), false],
    [
      'network, keyed POST, second retry',
      input({ retrySafe: true, outcome: { kind: 'network' }, attempt: 1 }),
      true,
    ],
    ['network, plain POST', input({ retrySafe: false, outcome: { kind: 'network' } }), false],
    ['timeout, GET', input({ retrySafe: true, outcome: { kind: 'timeout' } }), true],
    ['timeout, PATCH', input({ retrySafe: false, outcome: { kind: 'timeout' } }), false],
    ['400 GET', input({ retrySafe: true, outcome: { kind: 'status', status: 400 } }), false],
    ['409 keyed POST', input({ retrySafe: true, outcome: { kind: 'status', status: 409 } }), false],
    [
      'retries exhausted',
      input({ retrySafe: true, outcome: { kind: 'status', status: 502 }, attempt: 2 }),
      false,
    ],
    [
      'maxRetries 0',
      input({ retrySafe: true, outcome: { kind: 'status', status: 502 }, maxRetries: 0 }),
      false,
    ],
    [
      'daily cap, Retry-After 5 h',
      input({
        retrySafe: true,
        outcome: { kind: 'status', status: 429, retryAfterMs: 18_000_000 },
      }),
      false,
    ],
  ];
  it.each(cases)('%s', (_name, value, expected) => {
    expect(decideRetry(value).retry).toBe(expected);
  });

  it('names why it does not retry', () => {
    expect(decideRetry(cases[cases.length - 1][1])).toEqual({
      retry: false,
      reason: 'retry_after_too_long',
    });
    expect(decideRetry(cases[10][1])).toEqual({ retry: false, reason: 'unsafe' });
  });

  it('waits Retry-After plus at most 10 % jitter', () => {
    const decision = (random: number) =>
      decideRetry(
        input({
          retrySafe: false,
          random: () => random,
          outcome: { kind: 'status', status: 429, retryAfterMs: 2000 },
        }),
      );
    expect(decision(0)).toEqual({ retry: true, delayMs: 2000 });
    expect(decision(1)).toEqual({ retry: true, delayMs: 2200 });
  });
});

describe('backoffMs', () => {
  it('doubles from 500 ms up to 8 s with equal jitter', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => backoffMs(n, () => 0))).toEqual([
      250, 500, 1000, 2000, 4000, 4000,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((n) => backoffMs(n, () => 1))).toEqual([
      500, 1000, 2000, 4000, 8000, 8000,
    ]);
  });
});
