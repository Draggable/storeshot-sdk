import type { Requester, RequestOptions } from '../core/request.js';
import type { DeviceList, QueryOf, StoreList, StoreRequirements, StoreTarget } from '../types.js';

export class Devices {
  constructor(private readonly request: Requester) {}

  /** `GET /devices`: the catalogue of output sizes (public). */
  list(query: QueryOf<'listDevices'> = {}, options?: RequestOptions): Promise<DeviceList> {
    return this.request('listDevices', { query, options });
  }
}

export class Stores {
  constructor(private readonly request: Requester) {}

  /** `GET /stores`. */
  list(options?: RequestOptions): Promise<StoreList> {
    return this.request('listStores', { options });
  }

  /** `GET /stores/{store}/requirements`. */
  requirements(store: StoreTarget, options?: RequestOptions): Promise<StoreRequirements> {
    return this.request('getStoreRequirements', { path: { store }, options });
  }
}
