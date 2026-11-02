import type { IdempotentRequestOptions, Requester, RequestOptions } from '../core/request.js';
import type { CreateGenerationRequest, Generation, GenerationList, QueryOf } from '../types.js';

/** Seconds a held request may wait at most (`Prefer: wait`, server cap). */
export const MAX_WAIT_SECONDS = 60;
/** Margin added to a held request's attempt timeout. */
export const WAIT_MARGIN_MS = 15_000;

export interface WaitOption {
  /** `Prefer: wait=<seconds>` (0–60): hold the answer until the generation is final. */
  wait?: number;
}

const held = (wait: number | undefined) =>
  wait === undefined
    ? {}
    : {
        wait: Math.min(MAX_WAIT_SECONDS, Math.max(0, wait)),
        minTimeoutMs: Math.min(MAX_WAIT_SECONDS, Math.max(0, wait)) * 1000 + WAIT_MARGIN_MS,
      };

export class Generations {
  constructor(private readonly request: Requester) {}

  /**
   * `POST /generations`: one screenshot → one store image. Live keys: 1 credit. Sent with an
   * Idempotency-Key (yours, or a new one reused across retries).
   */
  create(
    body: CreateGenerationRequest,
    options: IdempotentRequestOptions & WaitOption = {},
  ): Promise<Generation> {
    const { idempotencyKey, wait, ...rest } = options;
    return this.request('createGeneration', {
      json: body,
      idempotencyKey,
      ...held(wait),
      options: rest,
    });
  }

  /** `GET /generations`. */
  list(query: QueryOf<'listGenerations'> = {}, options?: RequestOptions): Promise<GenerationList> {
    return this.request('listGenerations', { query, options });
  }

  /** `GET /generations/{id}` (optionally held with `wait`). */
  get(id: string, options: RequestOptions & WaitOption = {}): Promise<Generation> {
    const { wait, ...rest } = options;
    return this.request('getGeneration', { path: { id }, ...held(wait), options: rest });
  }

  /** `POST /generations/{id}/cancel`. */
  cancel(id: string, options?: RequestOptions): Promise<Generation> {
    return this.request('cancelGeneration', { path: { id }, options });
  }

  /** `DELETE /generations/{id}`. */
  delete(id: string, options?: RequestOptions): Promise<void> {
    return this.request('deleteGeneration', { path: { id }, options });
  }
}
