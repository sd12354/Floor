import { DEFAULT_FEES, SEED_BLOCKED_BRANDS } from '@floor/core';
import type { Connectors } from './connectors.js';
import type { Db } from './db/client.js';
import type { Prisma } from './generated/prisma/client.js';
import { DEFAULT_ACCOUNT_ID } from './plugins/account.js';
import { DEFAULT_PRICING_RULE } from './serialize.js';
import { id, writeEvent } from './services/audit.js';
import { cacheSupplierCatalog } from './services/catalog.js';

/** Seed the blocklist (idempotent). */
export async function seedBlockedBrands(db: Db): Promise<number> {
  let added = 0;
  for (const pattern of SEED_BLOCKED_BRANDS) {
    const existing = await db.blockedBrand.findUnique({ where: { pattern } });
    if (existing) continue;
    await db.blockedBrand.create({ data: { id: id('brd'), pattern, source: 'seed' } });
    added += 1;
  }
  return added;
}

export interface SeedOptions {
  accountId?: string;
  name?: string;
  connectSupplier?: boolean;
  dailySpendCapCents?: number;
}

/** Create the demo account with one mock supplier connection and the catalog cached. Idempotent. */
export async function seedDemoAccount(db: Db, connectors: Connectors, opts: SeedOptions = {}): Promise<{ accountId: string; created: boolean }> {
  const accountId = opts.accountId ?? DEFAULT_ACCOUNT_ID;
  await seedBlockedBrands(db);
  const existing = await db.account.findUnique({ where: { id: accountId } });
  if (existing) return { accountId, created: false };

  await db.account.create({
    data: {
      id: accountId,
      name: opts.name ?? 'Demo Seller',
      pricingRule: DEFAULT_PRICING_RULE as unknown as Prisma.InputJsonValue,
      fees: { ...DEFAULT_FEES } as unknown as Prisma.InputJsonValue,
      dailySpendCapCents: opts.dailySpendCapCents ?? 50_000,
      smallLossToleranceCents: 500,
      handlingTimeDays: 3,
    },
  });
  await writeEvent(db, { accountId, type: 'account.created', payload: { mode: connectors.mode } });

  if ((opts.connectSupplier ?? true) && connectors.mode === 'mock') {
    const cached = await cacheSupplierCatalog(db, connectors, 'mock');
    await db.supplierConnection.create({ data: { id: id('sup'), accountId, supplier: 'mock', status: 'connected', label: 'Mock supplier (demo)' } });
    await writeEvent(db, { accountId, type: 'supplier.connected', payload: { supplier: 'mock', cached } });
  }
  return { accountId, created: true };
}

/** Called at API start in mock mode. Returns true when it created the demo account. */
export async function ensureSeeded(db: Db, connectors: Connectors): Promise<boolean> {
  const { created } = await seedDemoAccount(db, connectors);
  return created;
}

// CLI entry: `tsx src/seed.ts`
if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  const { loadConfig } = await import('./config.js');
  const { buildConnectors } = await import('./connectors.js');
  const { createDb } = await import('./db/client.js');
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const res = await seedDemoAccount(db, buildConnectors(config));
  console.log(res.created ? `Seeded ${res.accountId}` : `${res.accountId} already exists, nothing to do`);
  await db.$disconnect();
}
