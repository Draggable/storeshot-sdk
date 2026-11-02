import { ERROR_CODES, type ErrorCode, type OperationId } from './generated/operations.js';
import { parseRetryAfter } from './core/retryAfter.js';
import { scrub, scrubValue } from './core/redact.js';

/** Codes the SDK raises itself; never one of the API's `ErrorCode`s. */
export const SDK_ERROR_CODES = [
  'MISSING_API_KEY',
  'INVALID_CONFIGURATION',
  'BROWSER_NOT_ALLOWED',
  'CONNECTION_ERROR',
  'TIMEOUT',
  'WAIT_TIMEOUT',
  'UNEXPECTED_RESPONSE',
  'FILE_TOO_LARGE',
  'NODE_ONLY',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_PAYLOAD_INVALID',
  'DEVICE_ACCESS_DENIED',
  'DEVICE_CODE_EXPIRED',
  'DEVICE_INVALID_GRANT',
] as const;
export type SdkErrorCode = (typeof SDK_ERROR_CODES)[number];
/** An API `ErrorCode`, an SDK code, or a code added to the API after this SDK was built. */
export type StoreshotErrorCode = ErrorCode | SdkErrorCode | (string & {});

export interface StoreshotErrorInit {
  code: StoreshotErrorCode;
  message: string;
  /** HTTP status; 0 when there was no response. */
  status?: number;
  requestId?: string | null;
  docUrl?: string | null;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number | null;
  operationId?: OperationId | null;
  cause?: unknown;
  /** Values that must never appear in the message or details (the API key). */
  secrets?: readonly string[];
}

const brand = (kind: string) => Symbol.for(`storeshot.sdk.error.${kind}`);

/**
 * Every error the SDK throws for an API answer or a failed request. `instanceof` works across
 * the ESM and CommonJS copies of the package (brand symbols, not prototype identity).
 */
export class StoreshotError extends Error {
  static readonly kind: string = 'StoreshotError';

  static override [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    return (value as Record<symbol, unknown>)[brand(this.kind)] === true;
  }

  readonly status: number;
  readonly code: StoreshotErrorCode;
  readonly requestId: string | null;
  readonly docUrl: string | null;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | null;
  readonly operationId: OperationId | null;

  constructor(init: StoreshotErrorInit) {
    const secrets = init.secrets ?? [];
    super(
      scrub(init.message, secrets),
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    let ctor: unknown = new.target;
    while (typeof ctor === 'function' && Object.prototype.hasOwnProperty.call(ctor, 'kind')) {
      Object.defineProperty(this, brand((ctor as typeof StoreshotError).kind), { value: true });
      ctor = Object.getPrototypeOf(ctor);
    }
    this.name = (new.target as typeof StoreshotError).kind;
    this.status = init.status ?? 0;
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.docUrl = init.docUrl ?? null;
    this.details =
      init.details === undefined
        ? undefined
        : (scrubValue(init.details, secrets) as Record<string, unknown>);
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.operationId = init.operationId ?? null;
  }

  override toString(): string {
    const where = this.requestId ? ` (request ${this.requestId})` : '';
    return `${this.name} [${this.status} ${this.code}]: ${this.message}${where}`;
  }

  toJSON() {
    return {
      name: this.name,
      status: this.status,
      code: this.code,
      message: this.message,
      requestId: this.requestId,
      docUrl: this.docUrl,
      details: this.details,
      retryAfterSeconds: this.retryAfterSeconds,
      operationId: this.operationId,
    };
  }
}

/** No answer: DNS, connection, TLS or a reset before the response arrived. */
export class StoreshotConnectionError extends StoreshotError {
  static override readonly kind: string = 'StoreshotConnectionError';
}

/** An attempt ran out of time (`TIMEOUT`) or a wait helper did (`WAIT_TIMEOUT`). */
export class StoreshotTimeoutError extends StoreshotError {
  static override readonly kind: string = 'StoreshotTimeoutError';
}

/** A webhook payload whose signature or body is not acceptable. */
export class StoreshotWebhookError extends StoreshotError {
  static override readonly kind: string = 'StoreshotWebhookError';
}

const isEnvelope = (
  body: unknown,
): body is {
  error: {
    code: string;
    message: string;
    requestId?: string;
    docUrl?: string;
    details?: Record<string, unknown>;
  };
} => {
  const error = (body as { error?: unknown } | null)?.error as Record<string, unknown> | undefined;
  return typeof error?.code === 'string' && typeof error.message === 'string';
};

/** The `StoreshotError` for a non-2xx answer (parsed JSON body, or the raw text, or null). */
export function errorFromResponse(input: {
  status: number;
  body: unknown;
  headers: Headers;
  operationId: OperationId | null;
  secrets?: readonly string[];
}): StoreshotError {
  const retryAfterMs = parseRetryAfter(input.headers.get('retry-after'));
  const headerRequestId = input.headers.get('x-request-id');
  const common = {
    status: input.status,
    operationId: input.operationId,
    retryAfterSeconds: retryAfterMs === null ? null : Math.ceil(retryAfterMs / 1000),
    secrets: input.secrets,
  };
  if (isEnvelope(input.body)) {
    const { error } = input.body;
    return new StoreshotError({
      ...common,
      code: error.code,
      message: error.message,
      requestId: error.requestId ?? headerRequestId,
      docUrl: error.docUrl ?? null,
      details: error.details,
    });
  }
  return new StoreshotError({
    ...common,
    code: 'UNEXPECTED_RESPONSE',
    message: `HTTP ${input.status} without a Storeshot error body.`,
    requestId: headerRequestId,
  });
}

export const isApiErrorCode = (code: string): code is ErrorCode =>
  (ERROR_CODES as readonly string[]).includes(code);
