import type { EbayTokens, FetchLike, RealEbayConfig, TokenStore } from '../src/index.js';

export interface Call { url: string; method: string; headers: Record<string, string>; body: string | undefined }
export type Reply = { status?: number; json?: unknown; headers?: Record<string, string> };

/** Fake fetch: replies are consumed in order per call; every call is recorded. No network. */
export function fakeFetch(replies: Reply[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body });
    const r = replies.shift();
    if (!r) throw new Error(`unexpected request ${init?.method} ${url}`);
    const text = r.json === undefined ? '' : JSON.stringify(r.json);
    return { status: r.status ?? 200, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, text: async () => text };
  };
  return { fetch, calls };
}

export function memoryStore(initial: EbayTokens | null = null): TokenStore & { current: EbayTokens | null } {
  const s = { current: initial, get: async () => s.current, set: async (t: EbayTokens) => void (s.current = t) };
  return s;
}

export const NOW = new Date('2026-01-01T00:00:00.000Z');
export const fresh = (): EbayTokens => ({ accessToken: 'AT1', refreshToken: 'RT1', expiresAt: new Date(NOW.getTime() + 3600_000), refreshExpiresAt: new Date(NOW.getTime() + 86_400_000) });
export const baseCfg: RealEbayConfig = {
  clientId: 'cid', clientSecret: 'csecret', ruName: 'My-RuName', env: 'sandbox', now: () => NOW,
  fulfillmentPolicyId: 'FP', paymentPolicyId: 'PP', returnPolicyId: 'RP', merchantLocationKey: 'LOC1', defaultCategoryId: '9355',
};
export const listingInput = { sku: 'SKU 1/x', title: 'T', description: 'D', images: ['https://i/1.jpg'], priceCents: 1999, buyerShippingCents: 0, quantity: 5, handlingTimeDays: 2 };
export const jsonBody = (c: Call | undefined): any => JSON.parse(c?.body ?? 'null'); // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper

