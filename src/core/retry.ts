/**
 * SS-018 D4 / spec §8: when an attempt may be repeated, and after how long.
 *
 * - A 429, or a 503 envelope (`SERVICE_UNAVAILABLE`/`BILLING_UNAVAILABLE`) that carries
 *   `Retry-After`, is retried for every method: the server refused before doing any work (rate
 *   limits run before the handler, enqueue caps roll back, busy slots are taken before the body is
 *   read, a provider error says "Nothing changed").
 * - Other 5xx, network errors and timeouts are retried only when repeating is safe: GET, a POST
 *   that carries an Idempotency-Key, or a read-only POST. Never a plain POST, PATCH or DELETE.
 * - A Retry-After longer than `maxRetryAfterMs` (e.g. the daily cap until UTC midnight) is not
 *   waited for.
 */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 8000;
const REFUSAL_CODES = new Set(['SERVICE_UNAVAILABLE', 'BILLING_UNAVAILABLE']);

export type AttemptOutcome =
  | { kind: 'status'; status: number; code?: string | null; retryAfterMs?: number | null }
  | { kind: 'network' }
  | { kind: 'timeout' };

export interface RetryInput {
  /** True for GET, keyed POSTs and read-only POSTs. */
  retrySafe: boolean;
  outcome: AttemptOutcome;
  /** Retries already made for this call (0 after the first attempt). */
  attempt: number;
  maxRetries: number;
  maxRetryAfterMs: number;
  random?: () => number;
}

export type RetryDecision =
  | { retry: true; delayMs: number }
  | { retry: false; reason: 'not_retryable' | 'unsafe' | 'exhausted' | 'retry_after_too_long' };

/** Capped exponential backoff with equal jitter: [½, 1] × min(cap, base × 2^attempt). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(ceiling * (0.5 + random() / 2));
}

/** A refusal the server answered before doing any work. */
export function isRefusal(outcome: AttemptOutcome): boolean {
  if (outcome.kind !== 'status') return false;
  if (outcome.status === 429) return true;
  return (
    outcome.status === 503 &&
    outcome.retryAfterMs != null &&
    REFUSAL_CODES.has(String(outcome.code ?? ''))
  );
}

export function decideRetry(input: RetryInput): RetryDecision {
  const random = input.random ?? Math.random;
  const { outcome } = input;
  const transient = outcome.kind !== 'status' || outcome.status >= 500 || outcome.status === 429;
  if (!transient) return { retry: false, reason: 'not_retryable' };
  const refusal = isRefusal(outcome);
  if (!refusal && !input.retrySafe) return { retry: false, reason: 'unsafe' };
  if (input.attempt >= input.maxRetries) return { retry: false, reason: 'exhausted' };
  const retryAfterMs = outcome.kind === 'status' ? outcome.retryAfterMs : null;
  if (retryAfterMs != null) {
    if (retryAfterMs > input.maxRetryAfterMs)
      return { retry: false, reason: 'retry_after_too_long' };
    return { retry: true, delayMs: Math.round(retryAfterMs * (1 + random() / 10)) };
  }
  return { retry: true, delayMs: backoffMs(input.attempt, random) };
}
