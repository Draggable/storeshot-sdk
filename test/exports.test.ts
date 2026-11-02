import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as sdk from '../src/index.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? sources(file) : [file];
  });

/** The runtime exports of the package entry (types are checked by the consumer fixtures). */
export const RUNTIME_EXPORTS = [
  'CONTRACT_VERSION',
  'DEFAULT_BASE_URL',
  'DEFAULT_WEBHOOK_TOLERANCE_SECONDS',
  'ERROR_CODES',
  'SDK_ERROR_CODES',
  'SDK_VERSION',
  'Storeshot',
  'StoreshotConnectionError',
  'StoreshotError',
  'StoreshotTimeoutError',
  'StoreshotWebhookError',
  'WEBHOOK_EVENT_TYPES',
  'WEBHOOK_SIGNATURE_HEADER',
  'constructWebhookEvent',
  'default',
  'verifyWebhookSignature',
];

describe('package entry', () => {
  it('exports exactly the public runtime API', () => {
    expect(Object.keys(sdk).sort()).toEqual(RUNTIME_EXPORTS);
    expect(sdk.default).toBe(sdk.Storeshot);
  });

  it('keeps sources runtime-neutral: no static node: import, no import.meta', () => {
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/from\s+['"]node:/);
      expect(text, file).not.toMatch(/import\(\s*['"]node:/);
      expect(text, file).not.toMatch(/require\(/);
      expect(text, file).not.toMatch(/import\.meta/);
    }
  });
});
