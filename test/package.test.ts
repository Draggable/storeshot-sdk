import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IN_MONOREPO, SDK_ROOT, monorepoPath } from '../scripts/inputs.mjs';

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const pkg = read('../package.json');
/** sha256 of the canonical https://www.apache.org/licenses/LICENSE-2.0.txt */
const APACHE_2_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';

describe('package.json', () => {
  it('is the (not yet published) @draggable/storeshot-sdk in lockstep with the Storeshot release', () => {
    expect(pkg.name).toBe('@draggable/storeshot-sdk');
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    if (IN_MONOREPO) {
      const root = JSON.parse(readFileSync(monorepoPath('package.json'), 'utf8'));
      expect(pkg.version).toBe(root.version);
    }
    expect(pkg.private).toBeUndefined();
    expect(pkg.type).toBe('module');
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.engines).toEqual({ node: '>=18' });
    expect(pkg.files).toEqual(['dist', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE']);
    expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
    expect(pkg.license).toBe('Apache-2.0');
    expect(pkg.repository.type).toBe('git');
    if (IN_MONOREPO) {
      // The source package; the public mirror's package.json is written by the export.
      expect(pkg.repository.directory).toBe('packages/sdk');
    } else {
      expect(pkg.repository).toEqual({
        type: 'git',
        url: 'git+https://github.com/Draggable/storeshot-sdk.git',
      });
    }
    expect(pkg.homepage).toBe('https://storeshot.art/docs/');
    expect(pkg.scripts.prepublishOnly).toBe('node scripts/prepublish-guard.mjs');
  });

  it('ships the unmodified Apache License 2.0 and a NOTICE', () => {
    const licence = readFileSync(path.join(SDK_ROOT, 'LICENSE'));
    expect(createHash('sha256').update(licence).digest('hex')).toBe(APACHE_2_SHA256);
    const notice = readFileSync(path.join(SDK_ROOT, 'NOTICE'), 'utf8');
    expect(notice).toMatch(
      /^Storeshot TypeScript SDK \(@draggable\/storeshot-sdk\)\nCopyright 2026 \S/,
    );
  });

  it('has zero runtime dependencies and exact devDependency pins', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    for (const version of Object.values<string>(pkg.devDependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('exports ESM and CommonJS builds with their declarations', () => {
    expect(pkg.exports).toEqual({
      '.': {
        import: { types: './dist/esm/index.d.ts', default: './dist/esm/index.js' },
        require: { types: './dist/cjs/index.d.ts', default: './dist/cjs/index.js' },
      },
      './package.json': './package.json',
    });
    expect(pkg.main).toBe('./dist/cjs/index.js');
    expect(pkg.types).toBe('./dist/cjs/index.d.ts');
  });
});
