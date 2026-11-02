import type { Requester, RequestOptions } from '../core/request.js';
import type { CreditBalances, QueryOf, UsageReport } from '../types.js';

export class Credits {
  constructor(private readonly request: Requester) {}

  /** `GET /credits` (`usage:read`). */
  get(options?: RequestOptions): Promise<CreditBalances> {
    return this.request('getCredits', { options });
  }
}

export class Usage {
  constructor(private readonly request: Requester) {}

  /** `GET /usage` (`usage:read`). */
  get(query: QueryOf<'getUsage'> = {}, options?: RequestOptions): Promise<UsageReport> {
    return this.request('getUsage', { query, options });
  }
}
