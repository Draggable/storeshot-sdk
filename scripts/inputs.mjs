// Where the SDK finds its inputs. In the public mirror (Draggable/storeshot-sdk) they are files of
// this package, at the paths in INPUTS. In the Storeshot monorepo each has one source of truth
// outside the package, mapped by mirror/inputs.json (monorepo only, never exported); the mirror
// export copies them with the same map, so no copy ever exists in the monorepo.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SDK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Each input by name: its path in the mirror, relative to the package root. */
export const INPUTS = Object.freeze({
  contract: 'contract/openapi.json',
  webhookVectors: 'test/fixtures/webhook-signature-vectors.json',
  webhookSnippet: 'test/fixtures/verify-webhook.mjs',
});

const MAP_FILE = path.join(SDK_ROOT, 'mirror/inputs.json');
export const IN_MONOREPO = existsSync(MAP_FILE);
const map = IN_MONOREPO ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) : null;

/** A file of the monorepo (throws in the mirror). */
export function monorepoPath(rel) {
  if (!map) throw new Error(`${rel}: not inside the Storeshot monorepo`);
  return path.resolve(SDK_ROOT, map.monorepoRoot, rel);
}

/** Absolute path of an input (`contract`, `webhookVectors`, `webhookSnippet`). */
export function inputPath(name) {
  const rel = INPUTS[name];
  if (!rel) throw new Error(`unknown SDK input ${name}`);
  if (!map) return path.join(SDK_ROOT, rel);
  const source = map.inputs[rel];
  if (!source) throw new Error(`mirror/inputs.json has no source for ${rel}`);
  return monorepoPath(source);
}
