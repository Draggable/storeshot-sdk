#!/usr/bin/env node
// `prepublishOnly` of @storeshot/sdk (SS-018 D7; mirror decision of 2026-11-02). The package is
// published only by .github/workflows/publish.yml of the PUBLIC mirror Draggable/storeshot-sdk
// (npm provenance needs a public repository; that workflow sets STORESHOT_SDK_PUBLISH=1), never
// from the Storeshot monorepo or a laptop, and only under the Apache-2.0 licence with its LICENSE
// and NOTICE files. Dry runs (`npm publish --dry-run`) are held to the same rules.
import { existsSync, readFileSync } from 'node:fs';

const MIRROR = 'Draggable/storeshot-sdk';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dryRun = process.env.npm_config_dry_run === 'true';
const problems = [];
if (
  process.env.STORESHOT_SDK_PUBLISH !== '1' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.GITHUB_REPOSITORY !== MIRROR
) {
  problems.push(
    `publishing @storeshot/sdk is only done by .github/workflows/publish.yml of ${MIRROR}`,
  );
}
if (pkg.license !== 'Apache-2.0') {
  problems.push(`the licence must be Apache-2.0 (package.json says ${pkg.license ?? 'nothing'})`);
}
const missing = ['LICENSE', 'NOTICE'].filter(
  (f) => !existsSync(new URL(`../${f}`, import.meta.url)),
);
if (missing.length) problems.push(`LICENSE and NOTICE must ship (missing ${missing.join(', ')})`);
if (problems.length) {
  for (const problem of problems) console.error(`refusing to publish: ${problem}`);
  process.exit(1);
}
console.log(`publishing ${pkg.name}@${pkg.version}${dryRun ? ' (dry run)' : ''}`);
