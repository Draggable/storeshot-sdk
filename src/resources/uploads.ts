import type { Requester, RequestOptions } from '../core/request.js';
import { toUploadBlob, type UploadFileInput } from '../helpers/files.js';
import type {
  CreateUploadFromUrl,
  PresignedUpload,
  PresignUploadRequest,
  QueryOf,
  Upload,
  UploadList,
} from '../types.js';

export type CreateUploadInput = UploadFileInput | CreateUploadFromUrl;

export class Uploads {
  constructor(private readonly request: Requester) {}

  /**
   * `POST /uploads`: a file (`{ file }`: a path on Node, bytes, a Blob or a stream; one multipart
   * part) or a URL the server fetches (`{ url }`). PNG, JPEG or WebP, at most 20 MiB.
   */
  async create(input: CreateUploadInput, options?: RequestOptions): Promise<Upload> {
    if ('url' in input) return this.request('createUpload', { json: { url: input.url }, options });
    const { blob, filename } = await toUploadBlob(input);
    const form = () => {
      const data = new FormData();
      data.append('file', blob, filename);
      return data;
    };
    return this.request('createUpload', { form, options });
  }

  /** `GET /uploads`. */
  list(query: QueryOf<'listUploads'> = {}, options?: RequestOptions): Promise<UploadList> {
    return this.request('listUploads', { query, options });
  }

  /** `POST /uploads/presign`: then PUT the file to `url` and call `complete(id)`. */
  presign(body: PresignUploadRequest, options?: RequestOptions): Promise<PresignedUpload> {
    return this.request('presignUpload', { json: body, options });
  }

  /** `POST /uploads/{id}/complete`. */
  complete(id: string, options?: RequestOptions): Promise<Upload> {
    return this.request('completeUpload', { path: { id }, options });
  }

  /** `GET /uploads/{id}`. */
  get(id: string, options?: RequestOptions): Promise<Upload> {
    return this.request('getUpload', { path: { id }, options });
  }

  /** `DELETE /uploads/{id}`. */
  delete(id: string, options?: RequestOptions): Promise<void> {
    return this.request('deleteUpload', { path: { id }, options });
  }
}
