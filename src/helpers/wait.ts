import { sleep } from '../core/signal.js';
import { StoreshotTimeoutError } from '../errors.js';
import type { Generation, ScreenshotSet } from '../types.js';

export const GENERATION_FINAL: readonly string[] = ['succeeded', 'failed', 'canceled'];
export const SCREENSHOT_SET_FINAL: readonly string[] = [
  'succeeded',
  'partially_failed',
  'failed',
  'canceled',
];
export const DEFAULT_WAIT_TIMEOUT_MS = 600_000;
export const DEFAULT_POLL_INTERVAL_MS = 3000;

export interface WaitOptions {
  /** Give up after this long (default 10 minutes): `StoreshotTimeoutError` `WAIT_TIMEOUT`. */
  timeoutMs?: number;
  /** Pause between polls (default 3 s). */
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

const timedOut = (kind: string, id: string, status: string | undefined, timeoutMs: number) =>
  new StoreshotTimeoutError({
    code: 'WAIT_TIMEOUT',
    message: `${kind} ${id} is still ${status ?? 'unfinished'} after ${timeoutMs} ms.`,
    details: { id, status: status ?? null },
  });

type GetGeneration = (
  id: string,
  options: { wait: number; signal?: AbortSignal },
) => Promise<Generation>;

/**
 * Long-polls `GET /generations/{id}` with `Prefer: wait` until the generation is final, and
 * resolves with it (a `failed` or `canceled` generation is returned, not thrown).
 */
export async function waitForGeneration(
  get: GetGeneration,
  target: string | Generation,
  options: WaitOptions = {},
): Promise<Generation> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (typeof target !== 'string' && GENERATION_FINAL.includes(target.status)) return target;
  const id = typeof target === 'string' ? target : target.id;
  let status = typeof target === 'string' ? undefined : target.status;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timedOut('Generation', id, status, timeoutMs);
    const wait = Math.min(60, Math.floor(remaining / 1000));
    const started = Date.now();
    const generation = await get(id, { wait, signal: options.signal });
    status = generation.status;
    if (GENERATION_FINAL.includes(generation.status)) return generation;
    // A busy server (or a browser that cannot read Preference-Applied) answers at once: pause.
    if (Date.now() - started < (wait * 1000) / 2) {
      const pause = Math.min(pollMs, deadline - Date.now());
      if (pause > 0) await sleep(pause, options.signal);
    }
  }
}

type GetScreenshotSet = (id: string, options: { signal?: AbortSignal }) => Promise<ScreenshotSet>;

/** Polls `GET /screenshot-sets/{id}` until the set is final and resolves with it. */
export async function waitForScreenshotSet(
  get: GetScreenshotSet,
  target: string | ScreenshotSet,
  options: WaitOptions = {},
): Promise<ScreenshotSet> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (typeof target !== 'string' && SCREENSHOT_SET_FINAL.includes(target.status)) return target;
  const id = typeof target === 'string' ? target : target.id;
  const deadline = Date.now() + timeoutMs;
  let status = typeof target === 'string' ? undefined : target.status;
  for (let first = typeof target === 'string'; ; first = false) {
    if (!first) {
      const pause = Math.min(pollMs, deadline - Date.now());
      if (pause <= 0) throw timedOut('Screenshot set', id, status, timeoutMs);
      await sleep(pause, options.signal);
    }
    const set = await get(id, { signal: options.signal });
    status = set.status;
    if (SCREENSHOT_SET_FINAL.includes(set.status)) return set;
    if (Date.now() >= deadline) throw timedOut('Screenshot set', id, status, timeoutMs);
  }
}
