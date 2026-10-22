import type { EbayAuth } from './ebayAuth.js';
import { EbayApiError, type EbayEnv, type FetchLike } from './ebayTypes.js';

export interface EbayRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  /** `apiz` hosts the Finances and Identity APIs. */
  host?: 'api' | 'apiz';
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Extra statuses that are not errors (e.g. 404 on a lookup). 2xx always are. */
  allow?: readonly number[];
}

export interface EbayResponse<T = unknown> {
  status: number;
  json: T;
  headers: { get(name: string): string | null };
}

/** Authenticated JSON client: bearer token, one refresh-and-retry on 401, eBay error bodies turned into EbayApiError. */
export class EbayHttp {
  constructor(private readonly auth: EbayAuth, private readonly env: EbayEnv, private readonly fetchImpl: FetchLike) {}

  private url(req: EbayRequest): string {
    const sandbox = this.env === 'sandbox' ? '.sandbox' : '';
    const host = `https://${req.host ?? 'api'}${sandbox}.ebay.com`;
    const qs = req.query ? `?${new URLSearchParams(req.query).toString()}` : '';
    return `${host}${req.path}${qs}`;
  }

  async request<T = unknown>(req: EbayRequest): Promise<EbayResponse<T>> {
    let token = await this.auth.accessToken();
    for (let attempt = 0; ; attempt += 1) {
      const res = await this.fetchImpl(this.url(req), {
        method: req.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...req.headers,
        },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      });
      if (res.status === 401 && attempt === 0) {
        token = await this.auth.refreshAfter401();
        continue;
      }
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if ((res.status >= 200 && res.status < 300) || req.allow?.includes(res.status)) {
        return { status: res.status, json: json as T, headers: res.headers };
      }
      throw toApiError(res.status, req, json);
    }
  }
}

interface ErrorBody {
  errors?: { errorId?: number; message?: string; longMessage?: string }[];
}

function toApiError(status: number, req: EbayRequest, json: unknown): EbayApiError {
  const errors = (json as ErrorBody | null)?.errors ?? [];
  const detail = errors.map((e) => e.longMessage ?? e.message).filter(Boolean).join('; ') || 'no error body';
  const ids = errors.map((e) => e.errorId).filter((n): n is number => typeof n === 'number');
  return new EbayApiError(status, `eBay ${req.method} ${req.path} failed (${status}): ${detail}`, ids);
}
