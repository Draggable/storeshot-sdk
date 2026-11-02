import { loadNodeModule } from '../core/crypto.js';
import { hasNodeBuiltins } from '../core/env.js';
import { StoreshotError } from '../errors.js';

/** The server's upload cap (`MAX_UPLOAD_BYTES`, 20 MiB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** A path (Node, Bun, Deno), bytes (`Uint8Array`, `Buffer`, `ArrayBuffer`), a Blob or a stream. */
export type UploadFile = string | Uint8Array | ArrayBuffer | Blob | ReadableStream<Uint8Array>;

export interface UploadFileInput {
  file: UploadFile;
  /** Part file name. Default: the path's base name, else `upload`. */
  filename?: string;
  /** Part content type. The server detects the format from the bytes either way. */
  contentType?: string;
}

interface FsPromises {
  stat(path: string): Promise<{ size: number; isFile(): boolean }>;
  readFile(path: string): Promise<Uint8Array>;
}

const tooLarge = (bytes: number | string) =>
  new StoreshotError({
    code: 'FILE_TOO_LARGE',
    message: `The file is larger than the ${MAX_UPLOAD_BYTES} bytes (20 MiB) an upload may have (${bytes}).`,
  });

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? 'upload';

async function readPath(path: string): Promise<Uint8Array> {
  if (!hasNodeBuiltins()) {
    throw new StoreshotError({
      code: 'NODE_ONLY',
      message:
        'Uploading from a file path needs Node, Bun or Deno; pass bytes, a Blob or a stream.',
    });
  }
  const fs = await loadNodeModule<FsPromises>('node:fs/promises');
  const info = await fs.stat(path);
  if (info.size > MAX_UPLOAD_BYTES) throw tooLarge(`${info.size} bytes`);
  return fs.readFile(path);
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(`more than ${MAX_UPLOAD_BYTES} bytes read`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Buffers an upload input into one Blob (checked against the 20 MiB cap before any request). */
export async function toUploadBlob(
  input: UploadFileInput,
): Promise<{ blob: Blob; filename: string }> {
  const { file } = input;
  const type = input.contentType ?? 'application/octet-stream';
  let filename = input.filename;
  let blob: Blob;
  if (typeof file === 'string') {
    filename ??= baseName(file);
    blob = new Blob([new Uint8Array(await readPath(file))], { type });
  } else if (file instanceof Blob) {
    blob = input.contentType ? new Blob([file], { type }) : file;
  } else if (file instanceof ArrayBuffer) {
    blob = new Blob([new Uint8Array(file)], { type });
  } else if (ArrayBuffer.isView(file)) {
    blob = new Blob([new Uint8Array(file.buffer, file.byteOffset, file.byteLength).slice()], {
      type,
    });
  } else if (file && typeof (file as ReadableStream).getReader === 'function') {
    blob = new Blob([new Uint8Array(await readStream(file as ReadableStream<Uint8Array>))], {
      type,
    });
  } else {
    throw new StoreshotError({
      code: 'INVALID_CONFIGURATION',
      message:
        'file must be a path, a Uint8Array/Buffer, an ArrayBuffer, a Blob or a ReadableStream.',
    });
  }
  if (blob.size > MAX_UPLOAD_BYTES) throw tooLarge(`${blob.size} bytes`);
  return { blob, filename: filename ?? 'upload' };
}
