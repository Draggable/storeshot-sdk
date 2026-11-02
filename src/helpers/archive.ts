import { loadNodeModule } from '../core/crypto.js';
import { hasNodeBuiltins } from '../core/env.js';
import { StoreshotError } from '../errors.js';

interface FileHandle {
  write(data: Uint8Array): Promise<unknown>;
  close(): Promise<void>;
}
interface FsPromises {
  open(path: string, flags: string): Promise<FileHandle>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: boolean }): Promise<void>;
}

/** The whole body as bytes (a `Buffer` on Node, which is a `Uint8Array`). */
export async function responseBytes(response: Response): Promise<Uint8Array> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const NodeBuffer = (
    globalThis as { Buffer?: { from(b: ArrayBufferLike, o: number, l: number): Uint8Array } }
  ).Buffer;
  return NodeBuffer ? NodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes;
}

/**
 * Streams the body to `<path>.part`, then renames it to `path`. On any error the part file is
 * removed and nothing is left at `path` by this call.
 */
export async function writeResponseToFile(
  response: Response,
  path: string,
): Promise<{ path: string; bytes: number }> {
  if (!hasNodeBuiltins()) {
    throw new StoreshotError({
      code: 'NODE_ONLY',
      message: 'Writing to a file path needs Node, Bun or Deno; use archive() or archiveStream().',
    });
  }
  const fs = await loadNodeModule<FsPromises>('node:fs/promises');
  const part = `${path}.part`;
  let bytes = 0;
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(part, 'w');
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await handle.write(value);
        bytes += value.byteLength;
      }
    }
    await handle.close();
    handle = undefined;
    await fs.rename(part, path);
    return { path, bytes };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(part, { force: true }).catch(() => undefined);
    throw error;
  }
}
