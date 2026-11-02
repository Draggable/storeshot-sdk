import type { IdempotentRequestOptions, Requester, RequestOptions } from '../core/request.js';
import { responseBytes, writeResponseToFile } from '../helpers/archive.js';
import type {
  CreateScreenshotSetRequest,
  QueryOf,
  RetriedScreenshotSet,
  RetryScreenshotSetRequest,
  ScreenshotSet,
  ScreenshotSetList,
  ScreenshotSetQuote,
} from '../types.js';

/** Default attempt timeout of archive downloads (they stream a whole ZIP). */
export const ARCHIVE_TIMEOUT_MS = 300_000;

export interface ArchiveOptions extends RequestOptions {
  /** `store` (default): `<store>/<device>/<NN>.png`; `fastlane`: the deliver/supply folders. */
  layout?: QueryOf<'getScreenshotSetArchive'>['layout'];
}

export class ScreenshotSets {
  constructor(private readonly request: Requester) {}

  /**
   * `POST /screenshot-sets`: every screen on every device of one or both stores. Live keys:
   * 1 credit per image, charged at once. Sent with an Idempotency-Key.
   */
  create(
    body: CreateScreenshotSetRequest,
    options: IdempotentRequestOptions = {},
  ): Promise<ScreenshotSet> {
    const { idempotencyKey, ...rest } = options;
    return this.request('createScreenshotSet', { json: body, idempotencyKey, options: rest });
  }

  /** `POST /screenshot-sets?dryRun=true`: what `create` would make and charge. Free. */
  quote(body: CreateScreenshotSetRequest, options?: RequestOptions): Promise<ScreenshotSetQuote> {
    return this.request('createScreenshotSet', {
      json: body,
      query: { dryRun: 'true' },
      readOnly: true,
      options,
    });
  }

  /** `GET /screenshot-sets`. */
  list(
    query: QueryOf<'listScreenshotSets'> = {},
    options?: RequestOptions,
  ): Promise<ScreenshotSetList> {
    return this.request('listScreenshotSets', { query, options });
  }

  /** `GET /screenshot-sets/{id}`. */
  get(id: string, options?: RequestOptions): Promise<ScreenshotSet> {
    return this.request('getScreenshotSet', { path: { id }, options });
  }

  /** `POST /screenshot-sets/{id}/retry`: new images for failed or canceled slots only. */
  retry(
    id: string,
    body: RetryScreenshotSetRequest = {},
    options?: RequestOptions,
  ): Promise<RetriedScreenshotSet> {
    return this.request('retryScreenshotSet', { path: { id }, json: body, options });
  }

  /** `POST /screenshot-sets/{id}/cancel`. */
  cancel(id: string, options?: RequestOptions): Promise<ScreenshotSet> {
    return this.request('cancelScreenshotSet', { path: { id }, options });
  }

  /** `DELETE /screenshot-sets/{id}`. */
  delete(id: string, options?: RequestOptions): Promise<void> {
    return this.request('deleteScreenshotSet', { path: { id }, options });
  }

  /** `GET /screenshot-sets/{id}/archive` as bytes. */
  archive(id: string, options: ArchiveOptions = {}): Promise<Uint8Array> {
    return this.download(id, options, responseBytes);
  }

  /** The archive as a stream (the timeout covers the response headers only). */
  archiveStream(id: string, options: ArchiveOptions = {}): Promise<ReadableStream<Uint8Array>> {
    return this.download(id, options, async (response) => {
      if (!response.body) throw new TypeError('The archive response has no body.');
      return response.body;
    });
  }

  /** Streams the archive to `filePath` (Node, Bun, Deno), via `<filePath>.part`. */
  downloadArchive(
    id: string,
    filePath: string,
    options: ArchiveOptions = {},
  ): Promise<{ path: string; bytes: number }> {
    return this.download(id, options, (response) => writeResponseToFile(response, filePath));
  }

  private download<T>(
    id: string,
    options: ArchiveOptions,
    raw: (response: Response) => Promise<T>,
  ): Promise<T> {
    const { layout, ...rest } = options;
    return this.request('getScreenshotSetArchive', {
      path: { id },
      query: { layout },
      accept: 'application/zip',
      minTimeoutMs: rest.timeoutMs === undefined ? ARCHIVE_TIMEOUT_MS : undefined,
      raw,
      options: rest,
    });
  }
}
