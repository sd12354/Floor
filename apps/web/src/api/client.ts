import type { ApiError } from './types';

export const API_BASE = '/api/v1';
export const ACCOUNT_ID = 'acc_demo';

export class FloorApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** Contract v1.1: zod issues for VALIDATION, `{ floorPriceCents }` for PRICE_BELOW_FLOOR. */
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'FloorApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return `${API_BASE}${path}`;
  const params = new URLSearchParams();
  for (const [k, val] of Object.entries(query)) {
    if (val !== undefined && val !== '') params.set(k, String(val));
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<T> {
  const res = await fetch(withQuery(path, opts.query), {
    method,
    headers: {
      'X-Account-Id': ACCOUNT_ID,
      Accept: 'application/json',
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `${res.status} ${res.statusText}`.trim();
    let details: unknown;
    try {
      const data = (await res.json()) as Partial<ApiError>;
      if (data.error) {
        code = data.error.code ?? code;
        message = data.error.message ?? message;
        details = data.error.details;
      }
    } catch {
      // non-JSON error body; keep status text
    }
    throw new FloorApiError(res.status, code, message, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(err: unknown): string {
  if (err instanceof FloorApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
