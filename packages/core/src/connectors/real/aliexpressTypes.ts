import type { FetchLike } from './ebayTypes.js';

export type { FetchLike } from './ebayTypes.js';

/** Default AliExpress Open Platform "sync" gateway (Singapore). VERIFIED (ae_sdk/iop-sdk default). */
export const ALIEXPRESS_GATEWAY = 'https://api-sg.aliexpress.com/sync';
/** TOP API version sent as the `v` system param. VERIFIED (ae_sdk sends "2.0"). */
export const ALIEXPRESS_API_VERSION = '2.0';

/**
 * Records the supplier order id Floor placed for an idempotency key (the eBay order id), so a replay returns the
 * same order instead of placing a second one. Injected so core does no I/O; the api backs it with the Order row
 * (`supplierOrderId`). AliExpress placeorder has no VERIFIED `out_order_id` dedupe, so Floor owns idempotency.
 */
export interface OrderRefStore {
  /** The supplier order id already placed for this idempotency key, or null if none. */
  get(idempotencyKey: string): Promise<string | null>;
  /** Record that this idempotency key produced this supplier order id. */
  set(idempotencyKey: string, supplierOrderId: string): Promise<void>;
}

export interface RealAliExpressConfig {
  /** AliExpress Open Platform app key. */
  appKey?: string;
  /** App secret (the HMAC key; never logged). */
  appSecret?: string;
  /**
   * OAuth access token (the `session` param). Obtained once by the seller through the AliExpress consent flow;
   * Floor does not implement that flow here (see the connector doc comment). A dead token raises a reauth error.
   */
  accessToken?: string;
  /** Override the gateway (tests / EU gateway). Defaults to ALIEXPRESS_GATEWAY. */
  gateway?: string;
  /** Ship-from country for freight and order calls (where the parcel originates). Default 'CN'. */
  sendGoodsCountry?: string;
  /** Currency AliExpress should price product/freight in. Floor is USD-only. Default 'USD'. */
  currency?: string;
  /** Language for product detail. Default 'en_US'. */
  language?: string;
  /** Logistics service AliExpress should use when none is chosen per item (e.g. 'CAINIAO_STANDARD'). */
  defaultLogisticsService?: string;
  /** Idempotency store: maps an eBay order id to the supplier order already placed for it. See OrderRefStore. */
  orderRefStore?: OrderRefStore;
  /** Defaults to global fetch. Tests inject a fake so nothing touches the network. */
  fetch?: FetchLike;
  now?: () => Date;
  /** Receives non-secret diagnostics (never the secret or token). */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

/** A non-2xx HTTP answer, or an AliExpress error envelope (code/sub_code), from the gateway. Never carries secrets. */
export class AliExpressApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** AliExpress business error code (`code` or `sub_code`), when present. */
    public readonly aeCode?: string,
  ) {
    super(message);
    this.name = 'AliExpressApiError';
  }
}

/** The access token is dead/invalid: the seller must re-authorize AliExpress. Mirrors EbayReauthRequiredError. */
export class AliExpressReauthRequiredError extends Error {
  readonly code = 'ALIEXPRESS_REAUTH_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'AliExpressReauthRequiredError';
  }
}

/**
 * AliExpress error codes that mean the token is invalid/expired, so the seller must reconnect.
 * VERIFIED names from the IOP error reference; treated as reauth rather than transient.
 */
export const ALIEXPRESS_AUTH_ERROR_CODES: readonly string[] = [
  'InvalidSession',
  'InvalidAccessToken',
  'AccessTokenExpired',
  'MissingAccessToken',
  'InvalidToken',
  'InvalidSessionKey',
];
