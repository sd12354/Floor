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
  port: number;
  databaseUrl: string;
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
  /** How often the real-mode eBay order poller runs. */
  orderPollIntervalMs: number;
  cjApiKey?: string;
  spocketApiKey?: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const mode: FloorMode = process.env.FLOOR_MODE === 'real' ? 'real' : 'mock';
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean);
  const base: AppConfig = {
    mode,
    nodeEnv,
    port: int('PORT', 4000),
    databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
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
    orderPollIntervalMs: int('EBAY_ORDER_POLL_MS', 60_000),
    cjApiKey: process.env.CJ_API_KEY || undefined,
    spocketApiKey: process.env.SPOCKET_API_KEY || undefined,
  };
  return { ...base, ...overrides };
}
