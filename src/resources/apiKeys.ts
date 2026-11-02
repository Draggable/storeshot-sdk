import type { Requester, RequestOptions } from '../core/request.js';
import type { ApiKeyList, CreateApiKeyRequest, CreatedApiKey } from '../types.js';

export class ApiKeys {
  constructor(private readonly request: Requester) {}

  /** `POST /api-keys` (`keys:manage`). The secret is in the answer only once. */
  create(body: CreateApiKeyRequest, options?: RequestOptions): Promise<CreatedApiKey> {
    return this.request('createApiKey', { json: body, options });
  }

  /** `GET /api-keys`. */
  list(options?: RequestOptions): Promise<ApiKeyList> {
    return this.request('listApiKeys', { options });
  }

  /** `DELETE /api-keys/{id}`. */
  revoke(id: string, options?: RequestOptions): Promise<void> {
    return this.request('revokeApiKey', { path: { id }, options });
  }
}
