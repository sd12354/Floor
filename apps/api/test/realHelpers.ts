import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FetchLike } from '@floor/core';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { loadConfig, type AppConfig } from '../src/config.js';
import { buildConnectors, type Connectors } from '../src/connectors.js';
import { createDb, type Db } from '../src/db/client.js';
import { pushSchema } from '../src/db/push.js';
import { seedDemoAccount } from '../src/seed.js';
import { createSession, createUser } from '../src/services/auth.js';
import { hashPassword } from '../src/services/password.js';
import { buildServer } from '../src/server.js';

export const SECRET_KEY = Buffer.alloc(32, 7).toString('base64');

export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}
export type Responder = (req: Recorded) => { status?: number; json?: unknown } | undefined;

/** Fake eBay: `responders` are tried in order (first non-undefined wins); everything is recorded; unmatched requests fail loudly. */
export function fakeEbay(responders: Responder[] = []): { fetch: FetchLike; calls: Recorded[]; add(r: Responder): void } {
  const calls: Recorded[] = [];
  const rs = [...responders];
  const fetch: FetchLike = async (url, init) => {
    const rec: Recorded = { url, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body };
    calls.push(rec);
    const hit = rs.map((r) => r(rec)).find((x) => x !== undefined);
    if (!hit) throw new Error(`fake eBay: unexpected ${rec.method} ${url}`);
    return { status: hit.status ?? 200, headers: { get: () => null }, text: async () => (hit.json === undefined ? '' : JSON.stringify(hit.json)) };
  };
  return { fetch, calls, add: (r) => void rs.unshift(r) };
}

export const tokenOk = (access = 'ACCESS-1', refresh = 'REFRESH-1'): Responder => (r) =>
  r.url.endsWith('/identity/v1/oauth2/token') ? { json: { access_token: access, expires_in: 7200, refresh_token: refresh, refresh_token_expires_in: 47304000 } } : undefined;
export const identityOk = (username = 'sandbox_seller'): Responder => (r) => (r.url.includes('/commerce/identity/v1/user') ? { json: { username } } : undefined);

export interface RealTestApp {
  app: FastifyInstance;
  db: Db;
  connectors: Connectors;
  config: AppConfig;
  token: string;
  ebay: ReturnType<typeof fakeEbay>;
  api<T = unknown>(method: InjectOptions['method'], url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Record<string, unknown> }>;
  close(): Promise<void>;
}

/** FLOOR_MODE=real app on a temp SQLite DB with a fake eBay behind the connector. No network. */
export async function createRealTestApp(opts: { config?: Partial<AppConfig>; responders?: Responder[] } = {}): Promise<RealTestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-real-'));
  const databaseUrl = `file:${path.join(dir, 'test.db')}`;
  await pushSchema(databaseUrl);
  const base = loadConfig();
  const config = loadConfig({
    databaseUrl,
    mode: 'real',
    nodeEnv: 'test',
    schedulerEnabled: false,
    secretKey: SECRET_KEY,
    webOrigin: 'http://localhost:5173',
    webhookSecret: 'whsec-test',
    ebay: { ...base.ebay, clientId: 'cid', clientSecret: 'csecret', ruName: 'Test-RuName', env: 'sandbox' },
    ...opts.config,
  });
  const db = createDb(databaseUrl);
  const ebay = fakeEbay(opts.responders ?? [tokenOk(), identityOk()]);
  const connectors = buildConnectors(config, db, { fetch: ebay.fetch });
  await seedDemoAccount(db, connectors, { connectSupplier: false });
  const app = await buildServer({ config, db, connectors });
  await app.ready();
  const user = await createUser(db, 'seller@floor.test', await hashPassword('test-password-123'));
  const { token } = await createSession(db, user.id);
  return {
    app, db, connectors, config, token, ebay,
    async api(method, url, body, headers = {}) {
      const res = await app.inject({ method, url: `/api/v1${url}`, headers: { 'x-account-id': 'acc_demo', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
      let parsed: unknown = res.body;
      try {
        parsed = res.body ? JSON.parse(res.body) : null;
      } catch {
        // non-JSON (redirect)
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper, caller narrows
      return { status: res.statusCode, body: parsed as any, headers: res.headers };
    },
    async close() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const authed = (t: RealTestApp): Record<string, string> => ({ authorization: `Bearer ${t.token}` });
