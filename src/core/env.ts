interface ProcessLike {
  env?: Record<string, string | undefined>;
  versions?: { node?: string };
}

const processLike = (): ProcessLike | undefined =>
  (globalThis as { process?: ProcessLike }).process;

/** An environment variable where the runtime has `process.env` (Node, Bun, Deno), else undefined. */
export function readEnv(name: string): string | undefined {
  try {
    const value = processLike()?.env?.[name];
    return value === '' ? undefined : value;
  } catch {
    // Deno without --allow-env throws on access.
    return undefined;
  }
}

/** A page context (window + document), where an API key would be visible to every visitor. */
export const isBrowserLike = (): boolean => {
  const scope = globalThis as { window?: unknown; document?: unknown };
  return typeof scope.window !== 'undefined' && typeof scope.document !== 'undefined';
};

/** Node, or a runtime with Node's built-in modules (Bun, Deno). */
export const hasNodeBuiltins = (): boolean => typeof processLike()?.versions?.node === 'string';
