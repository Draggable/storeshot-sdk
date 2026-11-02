import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error untyped script
import { extractReadmeExample } from '../scripts/readme-example.mjs';
import { CONTRACT_VERSION } from '../src/index.js';
import { EXTRA_METHODS, OPERATION_MAP } from '../src/operationMap.js';
import { IN_MONOREPO } from '../scripts/inputs.mjs';
import { makeTempDir } from './helpers/tmp.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const CHANGELOG = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const tmp = makeTempDir('readme');
afterAll(() => tmp.remove());

const HEADINGS = [
  'Install',
  'API key',
  'Quick start',
  'Waiting',
  'Uploads',
  'Downloads',
  'Errors',
  'Retries and timeouts',
  'Idempotency',
  'Webhooks',
  'Test mode',
  'Runtimes',
  'Method reference',
  'Versioning',
];

describe('README (D8, D9)', () => {
  it('has the agent-oriented sections in order', () => {
    const found = [...README.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    // The public mirror's README ends with the section the export appends.
    expect(found).toEqual(IN_MONOREPO ? HEADINGS : [...HEADINGS, 'Source of truth']);
  });

  it('says near the top that the package is not on npm yet, and how to use it meanwhile', () => {
    const top = README.split('\n').slice(0, 15).join('\n');
    expect(top).toMatch(/Not on npm yet/);
    expect(top).toContain(IN_MONOREPO ? 'npm pack -w @draggable/storeshot-sdk' : 'npm pack');
    expect(top).toContain('npm install ./draggable-storeshot-sdk-<version>.tgz');
  });

  it('has one short main example that typechecks against the SDK', () => {
    const { code } = extractReadmeExample(README);
    const lines = code.split('\n').filter((line: string) => line.trim() !== '');
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(code).toContain("import { Storeshot } from '@draggable/storeshot-sdk';");
    expect(code).toContain('new Storeshot()');
    expect(code).toContain('downloadArchive');
    mkdirSync(tmp.dir, { recursive: true });
    const file = path.join(tmp.dir, 'example.mts');
    writeFileSync(file, code);
    const program = ts.createProgram([file], {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
      types: ['node'],
      typeRoots: [
        path.resolve(
          path.dirname(createRequire(import.meta.url).resolve('@types/node/package.json')),
          '..',
        ),
      ],
      baseUrl: ROOT,
      paths: { '@draggable/storeshot-sdk': ['src/index.ts'] },
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diagnostics).toEqual([]);
  });

  it('lists every client method in the method reference', () => {
    const section = README.split('## Method reference')[1].split('\n## ')[0];
    const listed = [...section.matchAll(/^\| `([A-Za-z.]+)` +\|/gm)].map((m) => m[1]).sort();
    const methods = [
      ...Object.values(OPERATION_MAP)
        .filter((v) => typeof v === 'string')
        .map(String),
      ...Object.keys(EXTRA_METHODS),
    ].sort();
    expect(listed).toEqual(methods);
  });

  it('never shows a key, and links only public hosts (never the legacy API)', () => {
    const PUBLIC_HOSTS = [
      'api.storeshot.art',
      'console.storeshot.art',
      'storeshot.art',
      'example.com',
      'hooks.example.com',
    ];
    for (const text of [README, CHANGELOG]) {
      expect(text).not.toMatch(/ss_(live|test)_[A-Za-z0-9]/);
      const hosts = [...text.matchAll(/https?:\/\/([^/\s)`'"<>]+)/g)].map((m) => m[1]);
      for (const host of hosts) expect(PUBLIC_HOSTS).toContain(host);
    }
  });

  it('starts the changelog with the unreleased first version of this contract', () => {
    expect(CHANGELOG).toMatch(
      new RegExp(
        `^# Changelog\\n\\n## Unreleased — first version \\(contract ${CONTRACT_VERSION.replace(/\./g, '\\.')}\\)\\n`,
      ),
    );
  });
});
