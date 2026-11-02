import type { Requester, RequestOptions } from '../core/request.js';
import type {
  CreateWebhookRequest,
  QueryOf,
  RotateWebhookSecretRequest,
  UpdateWebhookRequest,
  Webhook,
  WebhookDeliveryList,
  WebhookList,
  WebhookTestResult,
  WebhookWithSecret,
} from '../types.js';

export class Webhooks {
  constructor(private readonly request: Requester) {}

  /** `POST /webhooks` (`webhooks:write`). The secret is in the answer only once. */
  create(body: CreateWebhookRequest, options?: RequestOptions): Promise<WebhookWithSecret> {
    return this.request('createWebhook', { json: body, options });
  }

  /** `GET /webhooks`. */
  list(query: QueryOf<'listWebhooks'> = {}, options?: RequestOptions): Promise<WebhookList> {
    return this.request('listWebhooks', { query, options });
  }

  /** `GET /webhooks/{id}`. */
  get(id: string, options?: RequestOptions): Promise<Webhook> {
    return this.request('getWebhook', { path: { id }, options });
  }

  /** `PATCH /webhooks/{id}`. */
  update(id: string, body: UpdateWebhookRequest, options?: RequestOptions): Promise<Webhook> {
    return this.request('updateWebhook', { path: { id }, json: body, options });
  }

  /** `DELETE /webhooks/{id}`. */
  delete(id: string, options?: RequestOptions): Promise<void> {
    return this.request('deleteWebhook', { path: { id }, options });
  }

  /** `POST /webhooks/{id}/rotate-secret`: the new secret, once. */
  rotateSecret(
    id: string,
    body: RotateWebhookSecretRequest = {},
    options?: RequestOptions,
  ): Promise<WebhookWithSecret> {
    return this.request('rotateWebhookSecret', { path: { id }, json: body, options });
  }

  /** `POST /webhooks/{id}/test`: sends a signed `webhook.test` event. */
  test(id: string, options?: RequestOptions): Promise<WebhookTestResult> {
    return this.request('testWebhook', { path: { id }, options });
  }

  /** `GET /webhooks/{id}/deliveries`. */
  listDeliveries(
    id: string,
    query: QueryOf<'listWebhookDeliveries'> = {},
    options?: RequestOptions,
  ): Promise<WebhookDeliveryList> {
    return this.request('listWebhookDeliveries', { path: { id }, query, options });
  }
}
