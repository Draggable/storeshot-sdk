import type { OperationId } from './generated/operations.js';

/** `resource.method` (or a top-level client method) that calls the operation. */
export type MethodPath = string;
export interface Excluded {
  /** Why the SDK does not offer the operation (required, reviewed with the contract change). */
  excluded: string;
}

/**
 * SS-018 D2/§10: every operation of the contract, mapped to the client method that calls it.
 * Typed `Record<OperationId, …>`, so a regenerated contract with a new operation does not
 * compile until the operation is mapped or excluded with a reason.
 */
export const OPERATION_MAP = {
  addProjectItems: 'projects.addItems',
  cancelBillingSubscription: 'billing.cancelSubscription',
  cancelGeneration: 'generations.cancel',
  cancelScreenshotSet: 'screenshotSets.cancel',
  changeBillingSubscription: 'billing.changeSubscription',
  completeUpload: 'uploads.complete',
  createApiKey: 'apiKeys.create',
  createBillingCheckout: 'billing.createCheckout',
  createBillingPortalSession: 'billing.createPortalSession',
  createBillingSubscriptionCheckout: 'billing.createSubscriptionCheckout',
  createDeviceAuthorization: 'auth.startDeviceAuthorization',
  createDeviceToken: 'auth.pollDeviceToken',
  createGeneration: 'generations.create',
  createPalette: 'palettes.create',
  createProject: 'projects.create',
  createScreenshotSet: 'screenshotSets.create',
  createUpload: 'uploads.create',
  createWebhook: 'webhooks.create',
  deleteGeneration: 'generations.delete',
  deleteProject: 'projects.delete',
  deleteScreenshotSet: 'screenshotSets.delete',
  deleteUpload: 'uploads.delete',
  deleteWebhook: 'webhooks.delete',
  getBillingCheckout: 'billing.getCheckout',
  getBillingSubscription: 'billing.getSubscription',
  getCredits: 'credits.get',
  getGeneration: 'generations.get',
  getHealth: 'health',
  getMe: 'me',
  getProject: 'projects.get',
  getScreenshotSet: 'screenshotSets.get',
  getScreenshotSetArchive: 'screenshotSets.archive',
  getStatus: 'status',
  getStoreRequirements: 'stores.requirements',
  getUpload: 'uploads.get',
  getUsage: 'usage.get',
  getWebhook: 'webhooks.get',
  listActivity: 'activity.list',
  listApiKeys: 'apiKeys.list',
  listBillingPacks: 'billing.listPacks',
  listBillingPlans: 'billing.listPlans',
  listDevices: 'devices.list',
  listGenerations: 'generations.list',
  listProjects: 'projects.list',
  listScreenshotSets: 'screenshotSets.list',
  listStores: 'stores.list',
  listUploads: 'uploads.list',
  listWebhookDeliveries: 'webhooks.listDeliveries',
  listWebhooks: 'webhooks.list',
  presignUpload: 'uploads.presign',
  removeProjectItems: 'projects.removeItems',
  retryScreenshotSet: 'screenshotSets.retry',
  revokeApiKey: 'apiKeys.revoke',
  rotateWebhookSecret: 'webhooks.rotateSecret',
  testWebhook: 'webhooks.test',
  uncancelBillingSubscription: 'billing.uncancelSubscription',
  updateProject: 'projects.update',
  updateWebhook: 'webhooks.update',
} as const satisfies Record<OperationId, MethodPath | Excluded>;

/** Methods that call an operation already listed above (helpers over the same endpoint). */
export const EXTRA_METHODS = {
  'screenshotSets.quote': 'createScreenshotSet',
  'screenshotSets.archiveStream': 'getScreenshotSetArchive',
  'screenshotSets.downloadArchive': 'getScreenshotSetArchive',
  waitForGeneration: 'getGeneration',
  waitForScreenshotSet: 'getScreenshotSet',
  'auth.linkAccount': 'createDeviceToken',
} as const satisfies Record<string, OperationId>;
