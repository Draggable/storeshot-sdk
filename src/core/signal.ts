export interface AttemptSignal {
  signal: AbortSignal;
  /** True when the attempt's own timeout fired (not the caller's signal). */
  timedOut(): boolean;
  cleanup(): void;
}

/**
 * One request attempt's signal: aborted by the caller's signal or by the timeout, whichever comes
 * first. Linked by hand because `AbortSignal.any` needs Node ≥ 20.3.
 */
export function attemptSignal(parent: AbortSignal | undefined, timeoutMs: number): AttemptSignal {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', onAbort, { once: true });
  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort(new DOMException('The request timed out.', 'TimeoutError'));
        }, timeoutMs)
      : undefined;
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

/** Waits `ms`, rejecting with the signal's reason when it aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
