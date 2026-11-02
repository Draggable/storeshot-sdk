import {
  StoreshotConnectionError,
  StoreshotError,
  StoreshotTimeoutError,
  errorFromResponse,
} from '../errors.js';
import { OPERATIONS, type OperationId } from '../generated/operations.js';
import { randomUUID } from './crypto.js';
import { assertHeaderValue, assertRequestId, userHeaders } from './headers.js';
import { decideRetry, type AttemptOutcome } from './retry.js';
import { parseRetryAfter } from './retryAfter.js';
import { attemptSignal, sleep } from './signal.js';

/** What every response (each attempt) reports to `onResponse`. */
export interface ResponseMeta {
  operationId: OperationId;
  status: number;
  /** 0 for the first attempt. */
  attempt: number;
  requestId: string | null;
  /** `Idempotent-Replayed: true` (null when the header is absent or unreadable, e.g. CORS). */
  idempotentReplayed: boolean | null;
  rateLimit: string | null;
  rateLimitPolicy: string | null;
  retryAfterSeconds: number | null;
  headers: Headers;
}

/** Per-call options accepted by every method. */
export interface RequestOptions {
  signal?: AbortSignal;
  /** Per attempt, overrides the client's `timeoutMs`. */
  timeoutMs?: number;
  maxRetries?: number;
  /** Sent as `X-Request-Id` (1–128 of `A-Z a-z 0-9 _ - =`) to correlate with your logs. */
  requestId?: string;
  headers?: Record<string, string>;
  onResponse?: (meta: ResponseMeta) => void;
}

/** Options of the operations that accept an `Idempotency-Key`. */
export interface IdempotentRequestOptions extends RequestOptions {
  /** 1–255 printable ASCII characters. Default: a new UUID per call, reused across its retries. */
  idempotencyKey?: string;
}

export interface RequesterConfig {
  /** null: a key-less client (SS-019): only anonymous operations can be called. */
  apiKey: string | null;
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  maxRetryAfterMs: number;
  clientHeader: string;
  defaultHeaders: Record<string, string>;
  onResponse?: (meta: ResponseMeta) => void;
  random?: () => number;
}

export interface CallArgs<T = unknown> {
  path?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  /** Multipart body, rebuilt for every attempt. */
  form?: () => FormData;
  idempotencyKey?: string;
  /** `Prefer: wait=<seconds>`. */
  wait?: number;
  accept?: string;
  /** Lower bound for the attempt timeout (a held `Prefer: wait` request needs wait + margin). */
  minTimeoutMs?: number;
  /** Read-only POST (a quote): no Idempotency-Key, retried like a GET. */
  readOnly?: boolean;
  /** Handles a 2xx response instead of JSON parsing (binary answers), inside the attempt. */
  raw?: (response: Response) => Promise<T>;
  /** No `Authorization` header (anonymous operations, SS-019 device authorization). */
  anonymous?: boolean;
  /**
   * SS-019: a 400 whose JSON body has a string `error` (RFC 6749 §5.2) resolves as
   * `{ oauthError: { error, error_description } }` instead of throwing; never retried.
   */
  oauthErrors?: boolean;
  options?: RequestOptions;
}

/** What a call with `oauthErrors` resolves to on an RFC 6749 §5.2 error body. */
export interface OAuthErrorResult {
  oauthError: { error: string; error_description?: string };
}

/** POSTs that compute without storing anything, so repeating one is harmless. */
export const READ_ONLY_POSTS: Partial<Record<OperationId, string>> = {
  createPalette: 'computes a palette; stores nothing, charges nothing (SS-008)',
};

const IDEMPOTENCY_KEY = /^[\x20-\x7e]{1,255}$/;
const MAYBE_PROCESSED = ' The request may have reached the server; check before repeating it.';

export type Requester = <T>(operationId: OperationId, args?: CallArgs<T>) => Promise<T>;

export function buildUrl(
  baseUrl: string,
  operationId: OperationId,
  args: CallArgs<unknown>,
): string {
  const template = OPERATIONS[operationId].path as string;
  const path = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = args.path?.[name];
    if (value === undefined || value === '') {
      throw new StoreshotError({
        code: 'INVALID_CONFIGURATION',
        message: `${operationId}: missing path parameter "${name}".`,
        operationId,
      });
    }
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(args.query ?? {})) {
    if (value !== undefined && value !== null) query.append(key, String(value));
  }
  const search = query.toString();
  return `${baseUrl}${path}${search ? `?${search}` : ''}`;
}

const isOAuthError = (body: unknown): body is OAuthErrorResult['oauthError'] =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as { error?: unknown }).error === 'string';

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export function createRequester(config: RequesterConfig): Requester {
  const secrets = config.apiKey ? [config.apiKey] : [];
  const origin = new URL(config.baseUrl).origin;
  return async function request<T>(operationId: OperationId, args: CallArgs<T> = {}): Promise<T> {
    const operation = OPERATIONS[operationId];
    const options = args.options ?? {};
    if (!args.anonymous && config.apiKey === null) {
      throw new StoreshotError({
        code: 'MISSING_API_KEY',
        message: `${operationId} needs an API key; this client was created with apiKey: null (get one with client.auth.linkAccount()).`,
        operationId,
      });
    }
    const url = buildUrl(config.baseUrl, operationId, args);
    const headers: Record<string, string> = {
      ...config.defaultHeaders,
      ...userHeaders(options.headers),
      ...(args.anonymous ? {} : { Authorization: `Bearer ${config.apiKey}` }),
      'X-Storeshot-Client': config.clientHeader,
      Accept: args.accept ?? 'application/json',
    };
    if (args.json !== undefined) headers['Content-Type'] = 'application/json';
    if (args.wait !== undefined) headers.Prefer = `wait=${Math.max(0, Math.floor(args.wait))}`;
    if (options.requestId !== undefined) {
      assertRequestId(options.requestId);
      headers['X-Request-Id'] = options.requestId;
    }
    let keyed = false;
    if (operation.idempotencyKey && !args.readOnly) {
      const key = args.idempotencyKey ?? (await randomUUID());
      if (!IDEMPOTENCY_KEY.test(key)) {
        throw new StoreshotError({
          code: 'INVALID_CONFIGURATION',
          message: 'idempotencyKey must be 1–255 printable ASCII characters.',
          operationId,
        });
      }
      assertHeaderValue('Idempotency-Key', key);
      headers['Idempotency-Key'] = key;
      keyed = true;
    }
    const retrySafe =
      operation.method === 'GET' ||
      keyed ||
      Boolean(args.readOnly) ||
      READ_ONLY_POSTS[operationId] !== undefined;
    const timeoutMs = Math.max(options.timeoutMs ?? config.timeoutMs, args.minTimeoutMs ?? 0);
    const maxRetries = options.maxRetries ?? config.maxRetries;
    const hint = retrySafe ? '' : MAYBE_PROCESSED;

    for (let attempt = 0; ; attempt += 1) {
      const body =
        args.form !== undefined
          ? args.form()
          : args.json !== undefined
            ? JSON.stringify(args.json)
            : undefined;
      const scope = attemptSignal(options.signal, timeoutMs);
      let outcome: AttemptOutcome;
      let failure: StoreshotError;
      try {
        const response = await config.fetch(url, {
          method: operation.method,
          headers,
          body,
          signal: scope.signal,
        });
        const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        const meta: ResponseMeta = {
          operationId,
          status: response.status,
          attempt,
          requestId: response.headers.get('x-request-id'),
          idempotentReplayed:
            response.headers.get('idempotent-replayed') === null
              ? null
              : response.headers.get('idempotent-replayed') === 'true',
          rateLimit: response.headers.get('ratelimit'),
          rateLimitPolicy: response.headers.get('ratelimit-policy'),
          retryAfterSeconds: retryAfterMs === null ? null : Math.ceil(retryAfterMs / 1000),
          headers: response.headers,
        };
        config.onResponse?.(meta);
        options.onResponse?.(meta);
        if (response.ok) {
          if (args.raw) return await args.raw(response);
          if (response.status === 204) return undefined as T;
          const text = await response.text();
          if (!text) return undefined as T;
          try {
            return JSON.parse(text) as T;
          } catch {
            throw new StoreshotError({
              code: 'UNEXPECTED_RESPONSE',
              message: `HTTP ${response.status} with a body that is not JSON.`,
              status: response.status,
              requestId: meta.requestId,
              operationId,
            });
          }
        }
        const errorBody = await readBody(response);
        if (args.oauthErrors && response.status === 400 && isOAuthError(errorBody)) {
          return { oauthError: errorBody } as T;
        }
        failure = errorFromResponse({
          status: response.status,
          body: errorBody,
          headers: response.headers,
          operationId,
          secrets,
        });
        outcome = {
          kind: 'status',
          status: response.status,
          code: failure.code === 'UNEXPECTED_RESPONSE' ? null : failure.code,
          retryAfterMs,
        };
      } catch (error) {
        if (error instanceof StoreshotError) throw error;
        if (options.signal?.aborted) throw options.signal.reason;
        const cause = error instanceof Error ? error.message : String(error);
        if (scope.timedOut()) {
          outcome = { kind: 'timeout' };
          failure = new StoreshotTimeoutError({
            code: 'TIMEOUT',
            message: `No answer from ${origin} within ${timeoutMs} ms.${hint}`,
            operationId,
            secrets,
          });
        } else {
          outcome = { kind: 'network' };
          failure = new StoreshotConnectionError({
            code: 'CONNECTION_ERROR',
            message: `Could not reach ${origin}: ${cause}.${hint}`,
            operationId,
            cause: error,
            secrets,
          });
        }
      } finally {
        scope.cleanup();
      }
      const decision = decideRetry({
        retrySafe,
        outcome,
        attempt,
        maxRetries,
        maxRetryAfterMs: config.maxRetryAfterMs,
        random: config.random,
      });
      if (!decision.retry) throw failure;
      await sleep(decision.delayMs, options.signal);
    }
  };
}
