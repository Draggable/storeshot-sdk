import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Test temp files live in packages/sdk/.tmp/ (git-ignored), never in /tmp. */
export const TMP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp');

export function makeTempDir(prefix: string): { dir: string; remove(): void } {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(path.join(TMP_ROOT, `${prefix}-`));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
