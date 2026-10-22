export type EbayEnv = 'sandbox' | 'production';

/** OAuth tokens for one seller. Secrets: the host app must encrypt these at rest. */
export interface EbayTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

/** Where RealEbay keeps tokens. Injected so core does no I/O; the api backs it with an encrypted DB row. */
export interface TokenStore {
  get(): Promise<EbayTokens | null>;
  set(tokens: EbayTokens): Promise<void>;
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface RealEbayConfig {
  clientId?: string;
  clientSecret?: string;
  /** The eBay "RuName" (redirect URL name); sent as redirect_uri. Its accepted URL must point at /api/v1/account/ebay/callback. */
  ruName?: string;
  env?: EbayEnv;
  /** Static OAuth user token (sandbox testing). Used only when the TokenStore holds no tokens; cannot be refreshed. */
  userToken?: string;
  fulfillmentPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  merchantLocationKey?: string;
  defaultCategoryId?: string;
  /** Default EBAY_US. Money is USD only. */
  marketplaceId?: string;
  tokenStore?: TokenStore;
  /** Maps an eBay listing id back to the SKU it was created with (needed because Floor stores only ebayItemId). */
  resolveSku?: (ebayItemId: string) => Promise<string | null>;
  /** Defaults to global fetch. Tests inject a fake so nothing touches the network. */
  fetch?: FetchLike;
  now?: () => Date;
  /** Receives non-secret diagnostics (never tokens). */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/** A non-2xx answer from eBay (or a malformed one). Message never contains credentials. */
export class EbayApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errorIds: readonly number[] = [],
  ) {
    super(message);
    this.name = 'EbayApiError';
  }
}

/** The seller must reconnect eBay (no refresh token, or it expired / was revoked). */
export class EbayReauthRequiredError extends Error {
  readonly code = 'EBAY_REAUTH_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'EbayReauthRequiredError';
  }
}

export const DEFAULT_SCOPES: readonly string[] = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
];
