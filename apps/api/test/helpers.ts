import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildConnectors, type Connectors } from '../src/connectors.js';
import { loadConfig } from '../src/config.js';
import { createDb, type Db } from '../src/db/client.js';
import { pushSchema } from '../src/db/push.js';
import { seedDemoAccount } from '../src/seed.js';
import { createSession, createUser } from '../src/services/auth.js';
import { hashPassword } from '../src/services/password.js';
import { buildServer } from '../src/server.js';

export interface TestApp {
  app: FastifyInstance;
  db: Db;
  connectors: Connectors;
  /** Credentials of the signed-in test seller that `api` uses. */
  seller: { email: string; password: string; token: string };
  /** JSON request helper against /api/v1 with the demo account header, signed in as the test seller. */
  api<T = unknown>(method: InjectOptions['method'], url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
  /** Same as `api` but with no Authorization header, for auth tests. */
  anon<T = unknown>(method: InjectOptions['method'], url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
  close(): Promise<void>;
}

/** Fresh temp SQLite DB + seeded demo account per call. Scheduler is disabled (NODE_ENV=test). */
export async function createTestApp(opts: { dailySpendCapCents?: number; trackingDelayMs?: number } = {}): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-test-'));
  const databaseUrl = `file:${path.join(dir, 'test.db')}`;
  await pushSchema(databaseUrl);
  const config = loadConfig({ databaseUrl, mode: 'mock', nodeEnv: 'test', schedulerEnabled: false, mockTrackingDelayMs: opts.trackingDelayMs ?? 1000 });
  const db = createDb(databaseUrl);
  const connectors = buildConnectors(config);
  await seedDemoAccount(db, connectors, { dailySpendCapCents: opts.dailySpendCapCents });
  const app = await buildServer({ config, db, connectors });
  await app.ready();

  const password = 'test-password-123';
  const user = await createUser(db, 'seller@floor.test', await hashPassword(password));
  const { token } = await createSession(db, user.id);

  const call = async (method: InjectOptions['method'], url: string, body: unknown, headers: Record<string, string>) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { 'x-account-id': 'acc_demo', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    const text = res.body;
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON (csv)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper, caller narrows
    return { status: res.statusCode, body: parsed as any };
  };

  return {
    app,
    db,
    connectors,
    seller: { email: 'seller@floor.test', password, token },
    api: (method, url, body, headers = {}) => call(method, url, body, { authorization: `Bearer ${token}`, ...headers }),
    anon: (method, url, body, headers = {}) => call(method, url, body, headers),
    async close() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface ListingLike {
  id: string;
  status: string;
  priceCents: number;
  floorPriceCents: number;
  productId: string;
  product?: { supplierSku: string; costCents: number };
}

/** Find a compliant product, create and publish a listing for it. */
export async function publishOne(t: TestApp, q = 'tumbler'): Promise<ListingLike & { product: { supplierSku: string; costCents: number } }> {
  const disc = await t.api<{ items: { id: string; compliance: { ok: boolean } }[] }>('GET', `/discovery?q=${q}&pageSize=20`);
  const product = disc.body.items.find((i) => i.compliance.ok);
  if (!product) throw new Error(`no compliant product for ${q}`);
  const created = await t.api<{ created: ListingLike[] }>('POST', '/listings', { productIds: [product.id] });
  const draft = created.body.created[0];
  if (!draft) throw new Error('no draft created');
  const pub = await t.api<{ published: ListingLike[] }>('POST', '/listings/publish', { ids: [draft.id] });
  const listing = pub.body.published[0];
  if (!listing) throw new Error('not published');
  const row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id }, include: { product: true } });
  return { ...listing, product: { supplierSku: row.product.supplierSku, costCents: row.product.costCents } };
}
