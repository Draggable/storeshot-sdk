import type { OAuthErrorResult, Requester, RequestOptions } from '../core/request.js';
import { sleep } from '../core/signal.js';
import { StoreshotError } from '../errors.js';
import type { DeviceAuthorization, DeviceToken } from '../types.js';

/** RFC 8628 §3.4. */
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export interface StartDeviceAuthorizationInput {
  /** Shown to your human as an unverified label (1–64 printable ASCII characters). */
  clientName?: string;
  /** Scopes of the new key. Default: generations, uploads and usage read. */
  scopes?: string[];
  /** Default `live`. */
  environment?: 'live' | 'test';
}

export interface DeviceCode {
  /** Secret: pass it to `pollDeviceToken`, never show it. */
  deviceCode: string;
  /** Show it to your human. */
  userCode: string;
  verificationUri: string;
  /** The console page with the code filled in: the link to give your human. */
  verificationUriComplete: string;
  /** Seconds until the codes expire. */
  expiresIn: number;
  /** Seconds to wait between polls. */
  interval: number;
}

export interface LinkedAccount {
  /** The new API key (shown once: store it, never log it). */
  apiKey: string;
  keyId: string;
  scopes: string[];
  environment: 'live' | 'test';
}

export type DevicePoll =
  | ({ status: 'approved' } & LinkedAccount)
  | { status: 'authorization_pending' }
  | { status: 'slow_down'; retryAfterSeconds: number | null };

export interface LinkAccountOptions extends StartDeviceAuthorizationInput {
  /** Called once with what to show your human. */
  onCode: (code: Omit<DeviceCode, 'deviceCode' | 'interval'>) => void | Promise<void>;
  signal?: AbortSignal;
}

const TERMINAL: Record<string, { code: string; message: string }> = {
  access_denied: { code: 'DEVICE_ACCESS_DENIED', message: 'The request was denied.' },
  expired_token: {
    code: 'DEVICE_CODE_EXPIRED',
    message: 'The device code expired before it was approved.',
  },
  invalid_grant: { code: 'DEVICE_INVALID_GRANT', message: 'Unknown or already used device code.' },
};

/**
 * SS-019: device authorization (RFC 8628). No API key is needed: create the client with
 * `apiKey: null`. Nothing here logs the codes or the key.
 */
export class Auth {
  constructor(private readonly request: Requester) {}

  /** `POST /auth/device`: a user code for your human and a device code to poll with. */
  async startDeviceAuthorization(
    input: StartDeviceAuthorizationInput = {},
    options?: RequestOptions,
  ): Promise<DeviceCode> {
    const body: Record<string, string> = {};
    if (input.clientName !== undefined) body.client_name = input.clientName;
    if (input.scopes !== undefined) body.scope = input.scopes.join(' ');
    if (input.environment !== undefined) body.environment = input.environment;
    const r = await this.request<DeviceAuthorization>('createDeviceAuthorization', {
      anonymous: true,
      json: body,
      options,
    });
    return {
      deviceCode: r.device_code,
      userCode: r.user_code,
      verificationUri: r.verification_uri,
      verificationUriComplete: r.verification_uri_complete,
      expiresIn: r.expires_in,
      interval: r.interval,
    };
  }

  /**
   * `POST /auth/device/token`, once. Resolves `approved` (with the key), `authorization_pending`
   * or `slow_down`; throws `StoreshotError` `DEVICE_ACCESS_DENIED`, `DEVICE_CODE_EXPIRED` or
   * `DEVICE_INVALID_GRANT` when polling must stop.
   */
  async pollDeviceToken(deviceCode: string, options?: RequestOptions): Promise<DevicePoll> {
    let retryAfterSeconds: number | null = null;
    const r = await this.request<DeviceToken | OAuthErrorResult>('createDeviceToken', {
      anonymous: true,
      oauthErrors: true,
      json: { grant_type: DEVICE_GRANT_TYPE, device_code: deviceCode },
      options: {
        ...options,
        onResponse: (meta) => {
          retryAfterSeconds = meta.retryAfterSeconds;
          options?.onResponse?.(meta);
        },
      },
    });
    if ('oauthError' in r) {
      const { error, error_description: description } = r.oauthError;
      if (error === 'authorization_pending') return { status: 'authorization_pending' };
      if (error === 'slow_down') return { status: 'slow_down', retryAfterSeconds };
      const known = TERMINAL[error];
      throw new StoreshotError({
        code: known?.code ?? 'UNEXPECTED_RESPONSE',
        message: description || known?.message || `Device authorization failed: ${error}.`,
        status: 400,
        operationId: 'createDeviceToken',
        details: { error },
      });
    }
    return {
      status: 'approved',
      apiKey: r.access_token,
      keyId: r.key_id,
      scopes: r.scope ? r.scope.split(' ') : [],
      environment: r.environment,
    };
  }

  /**
   * The whole flow: starts, calls `onCode` with what to show your human, then polls every
   * `interval` seconds (5 more after each `slow_down`) until the human approves, and resolves
   * with the new key. Throws `DEVICE_ACCESS_DENIED` or `DEVICE_CODE_EXPIRED` otherwise.
   */
  async linkAccount(options: LinkAccountOptions): Promise<LinkedAccount> {
    const { onCode, signal, ...input } = options;
    const started = await this.startDeviceAuthorization(input, { signal });
    await onCode({
      userCode: started.userCode,
      verificationUri: started.verificationUri,
      verificationUriComplete: started.verificationUriComplete,
      expiresIn: started.expiresIn,
    });
    const deadline = Date.now() + started.expiresIn * 1000;
    let interval = started.interval;
    let wait = interval;
    for (;;) {
      await sleep(wait * 1000, signal);
      if (Date.now() > deadline) {
        throw new StoreshotError({
          code: 'DEVICE_CODE_EXPIRED',
          message: TERMINAL.expired_token.message,
          operationId: 'createDeviceToken',
        });
      }
      const poll = await this.pollDeviceToken(started.deviceCode, { signal });
      if (poll.status === 'approved') {
        const { status: _status, ...linked } = poll;
        return linked;
      }
      if (poll.status === 'slow_down') {
        // RFC 8628 §3.5: +5 s for this and every later poll; at least the server's Retry-After.
        interval += 5;
        wait = Math.max(interval, poll.retryAfterSeconds ?? 0);
      } else {
        wait = interval;
      }
    }
  }
}
