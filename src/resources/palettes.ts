import type { Requester, RequestOptions } from '../core/request.js';
import type { CreatePaletteRequest, Palette } from '../types.js';

export class Palettes {
  constructor(private readonly request: Requester) {}

  /** `POST /palettes`: a brand palette or the dominant colour (free, stores nothing). */
  create(body: CreatePaletteRequest, options?: RequestOptions): Promise<Palette> {
    return this.request('createPalette', { json: body, options });
  }
}
