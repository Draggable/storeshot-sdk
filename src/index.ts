export { Storeshot, DEFAULT_BASE_URL, type StoreshotOptions } from './client.js';
export {
  StoreshotConnectionError,
  StoreshotError,
  StoreshotTimeoutError,
  StoreshotWebhookError,
  SDK_ERROR_CODES,
  type SdkErrorCode,
  type StoreshotErrorCode,
} from './errors.js';
export {
  CONTRACT_VERSION,
  ERROR_CODES,
  WEBHOOK_EVENT_TYPES,
  type ErrorCode,
  type OperationId,
  type WebhookEventType,
} from './generated/operations.js';
export { SDK_VERSION } from './version.js';
export type { ClientIdentity, ClientSurface } from './core/headers.js';
export type { IdempotentRequestOptions, RequestOptions, ResponseMeta } from './core/request.js';
export type { UploadFile, UploadFileInput } from './helpers/files.js';
export type { WaitOptions } from './helpers/wait.js';
export type { CreateUploadInput } from './resources/uploads.js';
export type { ArchiveOptions } from './resources/screenshotSets.js';
export type { WaitOption } from './resources/generations.js';
export {
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  constructWebhookEvent,
  verifyWebhookSignature,
  type VerifyWebhookInput,
} from './webhooks/verify.js';
export * from './types.js';

import { Storeshot } from './client.js';
export default Storeshot;
