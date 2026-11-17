import path from 'node:path';

export type FloorMode = 'mock' | 'real';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface AppConfig {
  mode: FloorMode;
  nodeEnv: string;
  /** Bind address. Development stays on loopback; production listens on every interface unless HOST is set. */
  host: string;
  port: number;
  databaseUrl: string;
  /** Honour X-Forwarded-* when Floor sits behind a reverse proxy. */
  trustProxy: boolean;
  /** Built web dashboard to serve at /. Unset means API only. */
  webDist?: string;
  /** Allow an http WEB_ORIGIN in production (private network or local Docker). Public deploys stay https. */
  allowInsecureHttp: boolean;
  corsOrigins: string[];
  mockTrackingDelayMs: number;
  mockDeliveryDelayMs: number;
  syncIntervalMs: number;
  schedulerTickMs: number;
  schedulerEnabled: boolean;
  ebay: {
    clientId?: string;
    clientSecret?: string;
    ruName?: string;
    env: 'sandbox' | 'production';
    /** Static sandbox token fallback; the stored OAuth tokens win when present. */
    userToken?: string;
    fulfillmentPolicyId?: string;
    paymentPolicyId?: string;
    returnPolicyId?: string;
    merchantLocationKey?: string;
    defaultCategoryId?: string;
  };
  /** 32-byte key (64 hex chars or base64) for AES-256-GCM at-rest encryption of eBay tokens. Required in real mode to connect eBay. */
  secretKey?: string;
  /** Where the eBay OAuth callback sends the browser afterwards (the web app). */
  webOrigin: string;
  /** Shared secret for POST /webhooks/ebay callers that have no session (header X-Floor-Webhook-Secret). */
  webhookSecret?: string;
  /** eBay marketplace account-deletion notification: the verification token (32-80 chars, alphanumeric/_/-) set in the eBay portal. */
  ebayDeletionToken?: string;
  /** The exact https endpoint URL registered in the eBay portal for deletion notifications (used in the challenge hash). */
  ebayDeletionEndpoint?: string;
  /** How often the real-mode eBay order poller runs. */
  orderPollIntervalMs: number;
  cjApiKey?: string;
  spocketApiKey?: string;
  /** AliExpress Open Platform credentials. The access token is obtained once by the seller (see README). */
  aliexpress: {
    appKey?: string;
    appSecret?: string;
    accessToken?: string;
  };
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const mode: FloorMode = process.env.FLOOR_MODE === 'real' ? 'real' : 'mock';
  const webOriginEnv = process.env.WEB_ORIGIN?.trim();
  const corsRaw = process.env.CORS_ORIGINS;
  // A production process that forgets CORS_ORIGINS still has to accept its own dashboard origin.
  const corsFallback = nodeEnv === 'production' && !corsRaw && webOriginEnv
    ? webOriginEnv
    : 'http://localhost:5173,http://127.0.0.1:5173';
  const corsOrigins = (corsRaw ?? corsFallback).split(',').map((s) => s.trim()).filter(Boolean);
  const base: AppConfig = {
    mode,
    nodeEnv,
    host: process.env.HOST ?? (nodeEnv === 'production' ? '0.0.0.0' : '127.0.0.1'),
    port: int('PORT', 4000),
    databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
    trustProxy: process.env.TRUST_PROXY === '1',
    webDist: process.env.WEB_DIST ? path.resolve(process.env.WEB_DIST) : undefined,
    allowInsecureHttp: process.env.FLOOR_ALLOW_HTTP === '1',
    corsOrigins,
    mockTrackingDelayMs: int('MOCK_TRACKING_DELAY_MS', 30_000),
    mockDeliveryDelayMs: int('MOCK_DELIVERY_DELAY_MS', 60_000),
    syncIntervalMs: int('SYNC_INTERVAL_MS', 5 * 60_000),
    schedulerTickMs: int('SCHEDULER_TICK_MS', 10_000),
    schedulerEnabled: nodeEnv !== 'test' && process.env.SCHEDULER_DISABLED !== '1',
    ebay: {
      clientId: process.env.EBAY_CLIENT_ID || undefined,
      clientSecret: process.env.EBAY_CLIENT_SECRET || undefined,
      ruName: process.env.EBAY_RU_NAME || undefined,
      env: process.env.EBAY_ENV === 'production' ? 'production' : 'sandbox',
      userToken: process.env.EBAY_USER_TOKEN || undefined,
      fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID || undefined,
      paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID || undefined,
      returnPolicyId: process.env.EBAY_RETURN_POLICY_ID || undefined,
      merchantLocationKey: process.env.EBAY_MERCHANT_LOCATION_KEY || undefined,
      defaultCategoryId: process.env.EBAY_DEFAULT_CATEGORY_ID || undefined,
    },
    secretKey: process.env.FLOOR_SECRET_KEY || undefined,
    webOrigin: process.env.WEB_ORIGIN || corsOrigins[0] || 'http://localhost:5173',
    webhookSecret: process.env.FLOOR_WEBHOOK_SECRET || undefined,
    ebayDeletionToken: process.env.EBAY_DELETION_TOKEN || undefined,
    ebayDeletionEndpoint: process.env.EBAY_DELETION_ENDPOINT || undefined,
    orderPollIntervalMs: int('EBAY_ORDER_POLL_MS', 60_000),
    cjApiKey: process.env.CJ_API_KEY || undefined,
    spocketApiKey: process.env.SPOCKET_API_KEY || undefined,
    aliexpress: {
      appKey: process.env.ALIEXPRESS_APP_KEY || undefined,
      appSecret: process.env.ALIEXPRESS_APP_SECRET || undefined,
      accessToken: process.env.ALIEXPRESS_ACCESS_TOKEN || undefined,
    },
  };
  return { ...base, ...overrides };
}
