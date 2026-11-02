import type { IdempotentRequestOptions, Requester, RequestOptions } from '../core/request.js';
import type {
  BillingCheckout,
  BillingPackList,
  BillingPlanList,
  BillingPortalSession,
  BillingSubscriptionState,
  ChangeSubscriptionRequest,
  CreateBillingCheckoutRequest,
  CreatePortalSessionRequest,
  CreateSubscriptionCheckoutRequest,
} from '../types.js';

export class Billing {
  constructor(private readonly request: Requester) {}

  /** `GET /billing/packs` (`billing:read`). */
  listPacks(options?: RequestOptions): Promise<BillingPackList> {
    return this.request('listBillingPacks', { options });
  }

  /** `POST /billing/checkout`: a hosted checkout URL for a credit pack. */
  createCheckout(
    body: CreateBillingCheckoutRequest,
    options: IdempotentRequestOptions = {},
  ): Promise<BillingCheckout> {
    const { idempotencyKey, ...rest } = options;
    return this.request('createBillingCheckout', { json: body, idempotencyKey, options: rest });
  }

  /** `GET /billing/checkouts/{id}`. */
  getCheckout(id: string, options?: RequestOptions): Promise<BillingCheckout> {
    return this.request('getBillingCheckout', { path: { id }, options });
  }

  /** `GET /billing/plans`. */
  listPlans(options?: RequestOptions): Promise<BillingPlanList> {
    return this.request('listBillingPlans', { options });
  }

  /** `GET /billing/subscription`. */
  getSubscription(options?: RequestOptions): Promise<BillingSubscriptionState> {
    return this.request('getBillingSubscription', { options });
  }

  /** `POST /billing/subscription/checkout`. */
  createSubscriptionCheckout(
    body: CreateSubscriptionCheckoutRequest,
    options: IdempotentRequestOptions = {},
  ): Promise<BillingCheckout> {
    const { idempotencyKey, ...rest } = options;
    return this.request('createBillingSubscriptionCheckout', {
      json: body,
      idempotencyKey,
      options: rest,
    });
  }

  /** `POST /billing/subscription/change`. */
  changeSubscription(
    body: ChangeSubscriptionRequest,
    options?: RequestOptions,
  ): Promise<BillingSubscriptionState> {
    return this.request('changeBillingSubscription', { json: body, options });
  }

  /** `POST /billing/subscription/cancel` (at the end of the period). */
  cancelSubscription(options?: RequestOptions): Promise<BillingSubscriptionState> {
    return this.request('cancelBillingSubscription', { options });
  }

  /** `POST /billing/subscription/uncancel`. */
  uncancelSubscription(options?: RequestOptions): Promise<BillingSubscriptionState> {
    return this.request('uncancelBillingSubscription', { options });
  }

  /** `POST /billing/portal`: a customer portal session. */
  createPortalSession(
    body: CreatePortalSessionRequest = {},
    options?: RequestOptions,
  ): Promise<BillingPortalSession> {
    return this.request('createBillingPortalSession', { json: body, options });
  }
}
