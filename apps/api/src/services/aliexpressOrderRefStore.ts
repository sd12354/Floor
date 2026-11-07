import type { OrderRefStore } from '@floor/core';
import type { Db } from '../db/client.js';

/**
 * OrderRefStore backed by the Order table. The idempotency key is the eBay order id; the supplier order id already
 * placed for it is the Order row's `supplierOrderId`. This gives RealAliExpress its one-AliExpress-order-per-eBay-order
 * guarantee independently of the pipeline's own compare-and-set, so a retry after a crashed run never double-buys.
 *
 * `set` is intentionally a no-op: the order pipeline persists `supplierOrderId` on the Order row inside its own
 * compare-and-set transaction (which requires `supplierOrderId` to still be null), so writing it here would race
 * that CAS and strand the order. This store therefore only serves `get`, which is what a replay needs.
 * The connector is built before the db exists, hence `bind`.
 */
export class DbOrderRefStore implements OrderRefStore {
  private db: Db | null = null;

  bind(db: Db): void {
    this.db = db;
  }

  private requireDb(): Db {
    if (!this.db) throw new Error('DbOrderRefStore: database not bound');
    return this.db;
  }

  async get(idempotencyKey: string): Promise<string | null> {
    const row = await this.requireDb().order.findFirst({ where: { ebayOrderId: idempotencyKey, supplierOrderId: { not: null } }, select: { supplierOrderId: true } });
    return row?.supplierOrderId ?? null;
  }

  /** No-op: the pipeline persists supplierOrderId on the Order row inside its own transaction (see the class doc). */
  async set(_idempotencyKey: string, _supplierOrderId: string): Promise<void> {
    // Deliberately empty.
  }
}
