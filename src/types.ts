import type { components, operations } from './generated/schema.js';

export type { components, operations, paths, webhooks } from './generated/schema.js';

/** Every component schema of the contract, e.g. `Schemas['Generation']`. */
export type Schemas = components['schemas'];

type JsonContent<T> = T extends { content: { 'application/json': infer Body } } ? Body : never;
/** The JSON request body of an operation. */
export type RequestBodyOf<K extends keyof operations> = JsonContent<
  NonNullable<operations[K]['requestBody']>
>;
/** The query parameters of an operation. */
export type QueryOf<K extends keyof operations> = NonNullable<operations[K]['parameters']['query']>;

export type ApiKey = Schemas['ApiKey'];
export type ApiKeyList = Schemas['ApiKeyList'];
export type ActivityList = Schemas['ActivityList'];
export type BillingCheckout = Schemas['BillingCheckout'];
export type BillingPackList = Schemas['BillingPackList'];
export type BillingPlanList = Schemas['BillingPlanList'];
export type BillingPortalSession = Schemas['BillingPortalSession'];
export type BillingSubscriptionState = Schemas['BillingSubscriptionState'];
export type CreatedApiKey = Schemas['CreatedApiKey'];
export type CreditBalances = Schemas['CreditBalances'];
export type DeviceList = Schemas['DeviceList'];
export type DeviceAuthorization = Schemas['DeviceAuthorization'];
export type DeviceAuthorizationRequest = Schemas['DeviceAuthorizationRequest'];
export type DeviceToken = Schemas['DeviceToken'];
export type DeviceTokenError = Schemas['DeviceTokenError'];
export type ErrorEnvelope = Schemas['ErrorEnvelope'];
export type Generation = Schemas['Generation'];
export type GenerationList = Schemas['GenerationList'];
export type GenerationStatus = Schemas['GenerationStatus'];
export type HealthReport = Schemas['HealthReport'];
export type Me = Schemas['Me'];
export type Palette = Schemas['Palette'];
export type PresignedUpload = Schemas['PresignedUpload'];
export type Project = Schemas['Project'];
export type ProjectItemsAdded = Schemas['ProjectItemsAdded'];
export type ProjectItemsRemoved = Schemas['ProjectItemsRemoved'];
export type ProjectList = Schemas['ProjectList'];
export type RetriedScreenshotSet = Schemas['RetriedScreenshotSet'];
export type ScreenshotSet = Schemas['ScreenshotSet'];
export type ScreenshotSetList = Schemas['ScreenshotSetList'];
export type ScreenshotSetQuote = Schemas['ScreenshotSetQuote'];
export type ScreenshotSetStatus = Schemas['ScreenshotSetStatus'];
export type StatusReport = Schemas['StatusReport'];
export type StoreList = Schemas['StoreList'];
export type StoreRequirements = Schemas['StoreRequirements'];
export type StoreTarget = Schemas['StoreTarget'];
export type Upload = Schemas['Upload'];
export type UploadList = Schemas['UploadList'];
export type UsageReport = Schemas['UsageReport'];
export type Webhook = Schemas['Webhook'];
export type WebhookDeliveryList = Schemas['WebhookDeliveryList'];
export type WebhookList = Schemas['WebhookList'];
export type WebhookTestResult = Schemas['WebhookTestResult'];
export type WebhookWithSecret = Schemas['WebhookWithSecret'];

export type CreateApiKeyRequest = Schemas['CreateApiKeyRequest'];
export type CreateBillingCheckoutRequest = Schemas['CreateBillingCheckoutRequest'];
export type CreateGenerationRequest = Schemas['CreateGenerationRequest'];
export type CreatePaletteRequest = Schemas['CreatePaletteRequest'];
export type CreatePortalSessionRequest = Schemas['CreatePortalSessionRequest'];
export type CreateProjectRequest = Schemas['CreateProjectRequest'];
export type CreateScreenshotSetRequest = Schemas['CreateScreenshotSetRequest'];
export type CreateSubscriptionCheckoutRequest = Schemas['CreateSubscriptionCheckoutRequest'];
export type CreateUploadFromUrl = Schemas['CreateUploadFromUrl'];
export type CreateWebhookRequest = Schemas['CreateWebhookRequest'];
export type ChangeSubscriptionRequest = Schemas['ChangeSubscriptionRequest'];
export type PresignUploadRequest = Schemas['PresignUploadRequest'];
export type ProjectItemsRequest = Schemas['ProjectItemsRequest'];
export type RetryScreenshotSetRequest = Schemas['RetryScreenshotSetRequest'];
export type RotateWebhookSecretRequest = Schemas['RotateWebhookSecretRequest'];
export type UpdateProjectRequest = Schemas['UpdateProjectRequest'];
export type UpdateWebhookRequest = Schemas['UpdateWebhookRequest'];

export type GenerationSucceededEvent = Schemas['GenerationSucceededEvent'];
export type GenerationFailedEvent = Schemas['GenerationFailedEvent'];
export type ScreenshotSetCompletedEvent = Schemas['ScreenshotSetCompletedEvent'];
export type CreditsLowEvent = Schemas['CreditsLowEvent'];
export type WebhookTestEvent = Schemas['WebhookTestEvent'];
/** Every webhook event of the contract; narrow on `event.type`. */
export type WebhookEvent =
  | GenerationSucceededEvent
  | GenerationFailedEvent
  | ScreenshotSetCompletedEvent
  | CreditsLowEvent
  | WebhookTestEvent;
