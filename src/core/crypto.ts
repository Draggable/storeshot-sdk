/**
 * Loads a Node built-in at runtime. The specifier is a variable so bundlers for browsers and edge
 * runtimes leave it alone (it is only reached on Node-only code paths).
 */
export function loadNodeModule<T>(specifier: string): Promise<T> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ specifier) as Promise<T>;
}

let cached: Promise<Crypto> | undefined;

/** Web Crypto: the global where it exists, else Node's `webcrypto` (Node 18 has no global). */
export function getWebCrypto(): Promise<Crypto> {
  const global = (globalThis as { crypto?: Crypto }).crypto;
  if (global?.subtle && typeof global.randomUUID === 'function') return Promise.resolve(global);
  cached ??= loadNodeModule<{ webcrypto: Crypto }>('node:crypto').then((mod) => mod.webcrypto);
  return cached;
}

export async function randomUUID(): Promise<string> {
  return (await getWebCrypto()).randomUUID();
}
