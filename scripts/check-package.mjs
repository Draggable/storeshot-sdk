#!/usr/bin/env node
// SS-018 §4: checks the package exactly as npm would publish it. `npm pack` (local, no registry)
// into .pack/, exact file list, extract into .pack/consumer/node_modules/@storeshot/sdk, then
// require() + import() in child processes, tsc on three consumer setups, and esbuild bundles for
// the browser and a neutral (edge) platform. Needs `npm run build` first. `--keep` keeps .pack/.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const walk = (dir, base = dir) =>
  readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory()
      ? walk(file, base)
      : [path.relative(base, file).split(path.sep).join('/')];
  });

/** `npm pack` into `dest` and extract it into `dest/consumer/node_modules/@storeshot/sdk`. */
export function packSdk(dest) {
  mkdirSync(dest, { recursive: true });
  const npm = process.env.npm_execpath;
  const [cmd, prefix] = npm && npm.endsWith('.js') ? [process.execPath, [npm]] : ['npm', []];
  const out = execFileSync(cmd, [...prefix, 'pack', '--json', '--pack-destination', dest], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
  const [info] = JSON.parse(out.slice(out.indexOf('[')));
  const target = path.join(dest, 'consumer/node_modules/@storeshot/sdk');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    path.join(dest, info.filename),
    '-C',
    target,
    '--strip-components=1',
  ]);
  return {
    tarball: path.join(dest, info.filename),
    files: info.files.map((f) => f.path).sort(),
    dir: target,
    consumer: path.join(dest, 'consumer'),
  };
}

function expectedFiles() {
  const dist = walk(path.join(ROOT, 'dist')).map((f) => `dist/${f}`);
  return ['CHANGELOG.md', 'LICENSE', 'NOTICE', 'README.md', 'package.json', ...dist].sort();
}

function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}\n${error.stdout ?? ''}${error.stderr ?? ''}${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const dest = path.join(ROOT, '.pack');
  rmSync(dest, { recursive: true, force: true });
  const packed = packSdk(dest);
  const node = (args, cwd = packed.consumer) =>
    execFileSync(process.execPath, args, { cwd, encoding: 'utf8' });

  check('file list', () => {
    const allowed =
      /^(package\.json|README\.md|CHANGELOG\.md|LICENSE|NOTICE|dist\/cjs\/package\.json|dist\/(esm|cjs)\/.+\.(js|d\.ts))$/;
    const bad = packed.files.filter((f) => !allowed.test(f));
    if (bad.length) throw new Error(`unexpected files: ${bad.join(', ')}`);
    const expected = expectedFiles();
    if (JSON.stringify(packed.files) !== JSON.stringify(expected)) {
      throw new Error(
        `pack != dist: missing ${expected.filter((f) => !packed.files.includes(f))}, extra ${packed.files.filter((f) => !expected.includes(f))}`,
      );
    }
  });

  check('require() and import() expose the same API and version', () => {
    writeFileSync(
      path.join(packed.consumer, 'package.json'),
      '{ "name": "consumer", "private": true }\n',
    );
    const cjs = JSON.parse(
      node([
        '-e',
        "const m=require('@storeshot/sdk');console.log(JSON.stringify({k:Object.keys(m).sort(),v:m.SDK_VERSION,c:m.CONTRACT_VERSION,d:m.default===m.Storeshot}))",
      ]),
    );
    const esm = JSON.parse(
      node([
        '--input-type=module',
        '-e',
        "const m=await import('@storeshot/sdk');console.log(JSON.stringify({k:Object.keys(m).sort(),v:m.SDK_VERSION,c:m.CONTRACT_VERSION,d:m.default===m.Storeshot}))",
      ]),
    );
    if (JSON.stringify(cjs) !== JSON.stringify(esm))
      throw new Error(`cjs ${JSON.stringify(cjs)} != esm ${JSON.stringify(esm)}`);
    if (cjs.v !== pkg.version) throw new Error(`SDK_VERSION ${cjs.v} != ${pkg.version}`);
    if (!cjs.d) throw new Error('default export is not Storeshot');
  });

  const tsc = require.resolve('typescript/bin/tsc');
  // Wherever npm installed @types/node (the monorepo root or the mirror's own node_modules).
  const typeRoots = [path.resolve(path.dirname(require.resolve('@types/node/package.json')), '..')];
  const setups = {
    'esm.mts': {
      module: 'nodenext',
      moduleResolution: 'nodenext',
      lib: ['ES2022'],
      types: ['node'],
      typeRoots,
    },
    'cjs.cts': {
      module: 'nodenext',
      moduleResolution: 'nodenext',
      lib: ['ES2022'],
      types: ['node'],
      typeRoots,
    },
    'bundler.ts': {
      module: 'esnext',
      moduleResolution: 'bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: [],
    },
  };
  for (const [file, options] of Object.entries(setups)) {
    check(
      `types: ${file} (${options.moduleResolution}, lib ${options.lib.join('+')}, types [${options.types}])`,
      () => {
        const dir = path.join(packed.consumer, file.replace('.', '-'));
        mkdirSync(dir, { recursive: true });
        copyFileSync(path.join(ROOT, 'test/consumers', file), path.join(dir, file));
        const config = {
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: 'ES2022',
            skipLibCheck: false,
            ...options,
          },
          files: [file],
        };
        writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(config, null, 2));
        execFileSync(process.execPath, [tsc, '-p', dir], { cwd: dir, encoding: 'utf8' });
      },
    );
  }

  const esbuild = await import('esbuild');
  for (const platform of ['browser', 'neutral']) {
    check(`bundle: esbuild platform=${platform}`, () => {
      const result = esbuild.buildSync({
        entryPoints: [path.join(packed.dir, 'dist/esm/index.js')],
        bundle: true,
        write: false,
        format: 'esm',
        platform,
        logLevel: 'silent',
      });
      const text = result.outputFiles[0].text;
      if (/from\s*["']node:|require\(["']node:|import\(["']node:/.test(text))
        throw new Error('static node: import in the bundle');
      if (result.errors.length) throw new Error(result.errors.map((e) => e.text).join('\n'));
    });
  }

  if (process.exitCode) {
    console.error(`package check FAILED (kept ${path.relative(ROOT, dest)})`);
    return;
  }
  console.log(`package ok: ${packed.files.length} files, ${pkg.name}@${pkg.version}`);
  if (!process.argv.includes('--keep')) rmSync(dest, { recursive: true, force: true });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
