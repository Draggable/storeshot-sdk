// SS-018 consumer fixture (module: nodenext, CommonJS): resolves the `require` types.
import { Storeshot, StoreshotError, CONTRACT_VERSION } from '@storeshot/sdk';

async function main(): Promise<void> {
  const client = new Storeshot({ apiKey: 'ss_test_x', maxRetries: 1 });
  const set = await client.waitForScreenshotSet('s', { timeoutMs: 1000 });
  const bytes: Uint8Array = await client.screenshotSets.archive(set.id, { layout: 'fastlane' });
  console.log(bytes.byteLength, CONTRACT_VERSION);
  // @ts-expect-error unknown layout
  await client.screenshotSets.archive(set.id, { layout: 'zip' });
}
main().catch((error: unknown) => {
  if (error instanceof StoreshotError) console.error(error.code);
});
