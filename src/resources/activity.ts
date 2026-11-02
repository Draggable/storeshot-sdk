import type { Requester, RequestOptions } from '../core/request.js';
import type { ActivityList, QueryOf } from '../types.js';

export class Activity {
  constructor(private readonly request: Requester) {}

  /** `GET /activity` (`keys:manage`). */
  list(query: QueryOf<'listActivity'> = {}, options?: RequestOptions): Promise<ActivityList> {
    return this.request('listActivity', { query, options });
  }
}
