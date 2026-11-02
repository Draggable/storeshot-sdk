#!/usr/bin/env node
// SS-018 §4: dual build. dist/esm (ES modules) and dist/cjs (CommonJS, with its own
// package.json {"type":"commonjs"}), each with declarations and no source maps; then the
// package.json version is stamped into dist/*/version.js (src keeps '0.0.0-dev').
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const PLACEHOLDER = "'0.0.0-dev'";

rmSync(resolve(root, 'dist'), { recursive: true, force: true });
for (const config of ['tsconfig.build.esm.json', 'tsconfig.build.cjs.json']) {
  execFileSync(process.execPath, [tsc, '-p', config], { cwd: root, stdio: 'inherit' });
}
writeFileSync(resolve(root, 'dist/cjs/package.json'), '{\n  "type": "commonjs"\n}\n');

for (const format of ['esm', 'cjs']) {
  const file = resolve(root, `dist/${format}/version.js`);
  const text = readFileSync(file, 'utf8');
  const count = text.split(PLACEHOLDER).length - 1;
  if (count !== 1)
    throw new Error(`dist/${format}/version.js: expected one ${PLACEHOLDER}, found ${count}`);
  writeFileSync(file, text.replace(PLACEHOLDER, JSON.stringify(version).replace(/"/g, "'")));
}
console.log(`built @storeshot/sdk ${version} (dist/esm, dist/cjs)`);
