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
  ebay: { clientId?: string; clientSecret?: string; ruName?: string; env: 'sandbox' | 'production'; userToken?: string };
  cjApiKey?: string;
  spocketApiKey?: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const mode: FloorMode = process.env.FLOOR_MODE === 'real' ? 'real' : 'mock';
  const base: AppConfig = {
    mode,
    nodeEnv,
    port: int('PORT', 4000),
    databaseUrl: process.env.DATABASE_URL ?? 'file:./dev.db',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((s) => s.trim()).filter(Boolean),
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
    },
    cjApiKey: process.env.CJ_API_KEY || undefined,
    spocketApiKey: process.env.SPOCKET_API_KEY || undefined,
  };
  return { ...base, ...overrides };
}
