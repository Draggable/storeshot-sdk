import { isBrowserLike, readEnv } from './core/env.js';
import {
  assertCredential,
  clientHeader,
  userHeaders,
  type ClientIdentity,
} from './core/headers.js';
import { maskKey } from './core/redact.js';
import {
  createRequester,
  type Requester,
  type RequestOptions,
  type ResponseMeta,
} from './core/request.js';
import { StoreshotError } from './errors.js';
import { waitForGeneration, waitForScreenshotSet, type WaitOptions } from './helpers/wait.js';
import { Activity } from './resources/activity.js';
import { Auth } from './resources/auth.js';
import { ApiKeys } from './resources/apiKeys.js';
import { Billing } from './resources/billing.js';
import { Devices, Stores } from './resources/catalog.js';
import { Generations } from './resources/generations.js';
import { Palettes } from './resources/palettes.js';
import { Projects } from './resources/projects.js';
import { ScreenshotSets } from './resources/screenshotSets.js';
import { Uploads } from './resources/uploads.js';
import { Credits, Usage } from './resources/usage.js';
import { Webhooks } from './resources/webhooks.js';
import type { Generation, HealthReport, Me, ScreenshotSet, StatusReport } from './types.js';

export const DEFAULT_BASE_URL = 'https://api.storeshot.art/v1';
export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

export interface StoreshotOptions {
  /**
   * An API key (`ss_test_…` free, `ss_live_…` billed). Default: `STORESHOT_API_KEY`. `null`: a
   * client without a key, for `client.auth.*` only (get a key with `client.auth.linkAccount()`).
   */
  apiKey?: string | null;
  /** Default: `STORESHOT_BASE_URL`, else `https://api.storeshot.art/v1`. */
  baseUrl?: string;
  /** Per attempt (default 60 s). */
  timeoutMs?: number;
  /** Retries after a refused, failed or lost attempt where repeating is safe (default 2). */
  maxRetries?: number;
  /** Longest `Retry-After` the SDK waits for before throwing instead (default 60 s). */
  maxRetryAfterMs?: number;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** `X-Storeshot-Client` (default `api/storeshot-sdk-js@<version>`), for tools built on the SDK. */
  client?: ClientIdentity;
  /** Sent with every request; may not set Authorization, X-Storeshot-Client or Idempotency-Key. */
  defaultHeaders?: Record<string, string>;
  /** Called after every response (each attempt). */
  onResponse?: (meta: ResponseMeta) => void;
  /** Allow running in a web page. Anyone who can open the page can read the key. */
  dangerouslyAllowBrowser?: boolean;
}

const invalid = (message: string) => new StoreshotError({ code: 'INVALID_CONFIGURATION', message });

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

function normaliseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(`baseUrl must be an absolute URL (got "${value}").`);
  }
  const plainLocal = url.protocol === 'http:' && LOOPBACK.test(url.hostname);
  if (url.protocol !== 'https:' && !plainLocal) {
    throw invalid('baseUrl must use https: (http: only for localhost / 127.0.0.1 / [::1]).');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw invalid('baseUrl may not contain credentials, a query or a fragment.');
  }
  return url.href.replace(/\/+$/, '');
}

function positive(name: string, value: number | undefined, fallback: number, max = Infinity) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw invalid(`${name} must be a number between 0 and ${max}.`);
  }
  return value;
}

/**
 * The Storeshot API client. One instance per API key; it holds no other state and is safe to
 * share across concurrent requests.
 */
export class Storeshot {
  readonly baseUrl: string;
  readonly devices: Devices;
  readonly stores: Stores;
  readonly apiKeys: ApiKeys;
  readonly credits: Credits;
  readonly usage: Usage;
  readonly uploads: Uploads;
  readonly generations: Generations;
  readonly screenshotSets: ScreenshotSets;
  readonly projects: Projects;
  readonly palettes: Palettes;
  readonly webhooks: Webhooks;
  readonly activity: Activity;
  readonly billing: Billing;
  /** Device authorization (RFC 8628): get an API key with your human's approval, no key needed. */
  readonly auth: Auth;
  readonly #apiKey: string | null;
  readonly #request: Requester;

  constructor(options: StoreshotOptions = {}) {
    const apiKey =
      options.apiKey === null ? null : (options.apiKey ?? readEnv('STORESHOT_API_KEY'));
    if (apiKey !== null && !apiKey) {
      throw new StoreshotError({
        code: 'MISSING_API_KEY',
        message:
          'No API key: set STORESHOT_API_KEY (or pass apiKey). Create a free test key (ss_test_…) at https://console.storeshot.art/. Never paste a key into a chat, a log or a commit.',
      });
    }
    if (apiKey !== null) assertCredential(apiKey);
    if (isBrowserLike() && !options.dangerouslyAllowBrowser) {
      throw new StoreshotError({
        code: 'BROWSER_NOT_ALLOWED',
        message:
          'Storeshot API keys are secrets: call the API from your server, not from a web page. Pass dangerouslyAllowBrowser: true only if you accept that every visitor can read the key.',
      });
    }
    const fetchImpl =
      options.fetch ??
      ((input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof globalThis.fetch !== 'function') {
          throw invalid('This runtime has no global fetch; pass the fetch option.');
        }
        return globalThis.fetch(input, init);
      });
    this.#apiKey = apiKey;
    this.baseUrl = normaliseBaseUrl(
      options.baseUrl ?? readEnv('STORESHOT_BASE_URL') ?? DEFAULT_BASE_URL,
    );
    this.#request = createRequester({
      apiKey,
      baseUrl: this.baseUrl,
      fetch: fetchImpl,
      timeoutMs: positive('timeoutMs', options.timeoutMs, DEFAULT_TIMEOUT_MS),
      maxRetries: Math.floor(positive('maxRetries', options.maxRetries, DEFAULT_MAX_RETRIES, 10)),
      maxRetryAfterMs: positive(
        'maxRetryAfterMs',
        options.maxRetryAfterMs,
        DEFAULT_MAX_RETRY_AFTER_MS,
      ),
      clientHeader: clientHeader(options.client),
      defaultHeaders: userHeaders(options.defaultHeaders),
      onResponse: options.onResponse,
    });
    const request = this.#request;
    this.devices = new Devices(request);
    this.stores = new Stores(request);
    this.apiKeys = new ApiKeys(request);
    this.credits = new Credits(request);
    this.usage = new Usage(request);
    this.uploads = new Uploads(request);
    this.generations = new Generations(request);
    this.screenshotSets = new ScreenshotSets(request);
    this.projects = new Projects(request);
    this.palettes = new Palettes(request);
    this.webhooks = new Webhooks(request);
    this.activity = new Activity(request);
    this.billing = new Billing(request);
    this.auth = new Auth(request);
  }

  /** `GET /me`: the account and the credential (environment, scopes). */
  me(options?: RequestOptions): Promise<Me> {
    return this.#request('getMe', { options });
  }

  /** `GET /health` (public). */
  health(options?: RequestOptions): Promise<HealthReport> {
    return this.#request('getHealth', { options });
  }

  /** `GET /status` (public). */
  status(options?: RequestOptions): Promise<StatusReport> {
    return this.#request('getStatus', { options });
  }

  /** Resolves with the generation once it is `succeeded`, `failed` or `canceled`. */
  waitForGeneration(target: string | Generation, options?: WaitOptions): Promise<Generation> {
    return waitForGeneration(
      (id, { wait, signal }) => this.generations.get(id, { wait, signal }),
      target,
      options,
    );
  }

  /** Resolves with the set once it is `succeeded`, `partially_failed`, `failed` or `canceled`. */
  waitForScreenshotSet(
    target: string | ScreenshotSet,
    options?: WaitOptions,
  ): Promise<ScreenshotSet> {
    return waitForScreenshotSet(
      (id, { signal }) => this.screenshotSets.get(id, { signal }),
      target,
      options,
    );
  }

  toString(): string {
    return `Storeshot(baseUrl=${this.baseUrl}, apiKey=${this.#apiKey === null ? 'none' : maskKey(this.#apiKey)})`;
  }

  toJSON() {
    return {
      baseUrl: this.baseUrl,
      apiKey: this.#apiKey === null ? 'none' : maskKey(this.#apiKey),
    };
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return this.toString();
  }

  [Symbol.for('Deno.customInspect')]() {
    return this.toString();
  }
}
