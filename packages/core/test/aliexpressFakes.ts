import type { FetchLike } from '../src/index.js';
import type { OrderRefStore, RealAliExpressConfig } from '../src/index.js';

export interface Call { url: string; method: string; headers: Record<string, string>; body: string | undefined }
export type Reply = { status?: number; json?: unknown };

/** Fake fetch: replies are consumed in order per call; every call is recorded. No network. */
export function fakeFetch(replies: Reply[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body });
    const r = replies.shift();
    if (!r) throw new Error(`unexpected request ${init?.method} ${url}`);
    const text = r.json === undefined ? '' : JSON.stringify(r.json);
    return { status: r.status ?? 200, headers: { get: () => null }, text: async () => text };
  };
  return { fetch, calls };
}

/** In-memory OrderRefStore for idempotency tests. */
export function memoryOrderRefStore(): OrderRefStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
  };
}

export const NOW = new Date('2026-01-01T00:00:00.000Z');

export const baseCfg: RealAliExpressConfig = {
  appKey: 'app_key_1',
  appSecret: 'secret123',
  accessToken: 'tok',
  now: () => NOW,
};

/** Parse a recorded gateway POST body (form-urlencoded) into a param map. */
export function formParams(c: Call | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(c?.body ?? '')) out[k] = v;
  return out;
}

export const shipTo = {
  name: 'Jane Buyer',
  line1: '1 Market St',
  line2: 'Apt 2',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94105',
  country: 'US',
};
