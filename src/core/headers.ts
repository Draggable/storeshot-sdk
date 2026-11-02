import { StoreshotError } from '../errors.js';
import { SDK_VERSION } from '../version.js';

/** Same rule as the server (`v1/attribution.ts`); an invalid header would be ignored there. */
export const CLIENT_HEADER_PATTERN = /^(api|web|mcp|cli)\/[A-Za-z0-9._@+-]{1,100}$/;
/** Same rule as the server's request-id middleware. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_\-=]{1,128}$/;
/** Headers the SDK owns; `defaultHeaders` and per-call headers may not set them. */
export const RESERVED_HEADERS = ['authorization', 'x-storeshot-client', 'idempotency-key'];

export type ClientSurface = 'api' | 'web' | 'mcp' | 'cli';
export interface ClientIdentity {
  /** Usage label (`GET /usage?groupBy=source`): `api` by default; `cli`/`mcp` for such tools. */
  surface?: ClientSurface;
  /** 1–100 of `A-Z a-z 0-9 . _ @ + -`, e.g. `storeshot-cli@0.3.1`. */
  name?: string;
}

const invalid = (message: string) => new StoreshotError({ code: 'INVALID_CONFIGURATION', message });

export const defaultClientName = () => `storeshot-sdk-js@${SDK_VERSION}`;

/** The `X-Storeshot-Client` value, validated so the server never silently drops it. */
export function clientHeader(client: ClientIdentity = {}): string {
  const value = `${client.surface ?? 'api'}/${client.name ?? defaultClientName()}`;
  if (!CLIENT_HEADER_PATTERN.test(value)) {
    throw invalid(
      `Invalid client identity "${value}": surface api|web|mcp|cli, name of 1–100 characters A-Z a-z 0-9 . _ @ + -.`,
    );
  }
  return value;
}

/** Credentials: printable ASCII without spaces (no header injection, no stray newline). */
export function assertCredential(value: string): void {
  if (!/^[\x21-\x7e]+$/.test(value)) {
    throw invalid('The API key contains whitespace or non-printable characters.');
  }
}

/** Header values: printable ASCII or tab, no line breaks. */
export function assertHeaderValue(name: string, value: string): void {
  if (!/^[\t\x20-\x7e]*$/.test(value)) {
    throw invalid(`Header ${name} has a line break or a non-ASCII character.`);
  }
}

export function assertRequestId(value: string): void {
  if (!REQUEST_ID_PATTERN.test(value)) {
    throw invalid('requestId must be 1–128 characters of A-Z a-z 0-9 _ - =.');
  }
}

/** Validates user-supplied headers and refuses the ones the SDK owns. */
export function userHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (RESERVED_HEADERS.includes(name.toLowerCase())) {
      throw invalid(`Header ${name} is set by the SDK; use the matching option instead.`);
    }
    assertHeaderValue(name, value);
    out[name] = value;
  }
  return out;
}
