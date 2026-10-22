import type { FastifyInstance } from 'fastify';
import { serializeEvent } from '../serialize.js';
import { startOfUtcDay } from '../services/audit.js';
import { supplierSpendToday } from '../services/orderPipeline.js';

export const HEALTH_THRESHOLDS = { lateShipmentPct: 0.03, defectPct: 0.005 } as const;

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard', async (req) => {
    const account = await req.account();
    const now = new Date();
    const dayStart = startOfUtcDay(now);

    // Float: supplier money we have spent on orders whose eBay payout has not arrived yet.
    const outstanding = await app.db.order.findMany({
      where: { accountId: account.id, status: { in: ['ordered', 'shipped', 'delivered'] }, paidOutAt: null },
      include: { listing: { select: { title: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const byOrder = outstanding.map((o) => ({
      orderId: o.id,
      listingTitle: o.listing.title,
      amountCents: (o.supplierCostCents ?? 0) + (o.supplierShippingCents ?? 0),
      payoutExpectedAt: o.payoutExpectedAt ? o.payoutExpectedAt.toISOString() : null,
      status: o.status,
    }));
    const outstandingCents = byOrder.reduce((s, r) => s + r.amountCents, 0);

    // Today.
    const todayOrders = await app.db.order.findMany({ where: { accountId: account.id, createdAt: { gte: dayStart } } });
    const revenueCents = todayOrders.filter((o) => !['cancelled', 'refunded'].includes(o.status)).reduce((s, o) => s + o.salePriceCents + o.buyerShippingCents, 0);
    // Same figure the daily spend cap sees: ledger spend today plus what orders awaiting a manual supplier have reserved.
    const supplierSpendCents = await supplierSpendToday(app.db, account.id, now);
    const profitCents = todayOrders.filter((o) => ['ordered', 'shipped', 'delivered'].includes(o.status)).reduce((s, o) => s + (o.netProfitCents ?? 0), 0);

    // Health: late shipment = ordered past handling window; defects = cancelled after being ordered, plus refunds.
    const handlingCutoff = new Date(now.getTime() - account.handlingTimeDays * 24 * 60 * 60 * 1000);
    const [shippedOrOrdered, late, total, defects, casesOpen] = await Promise.all([
      app.db.order.count({ where: { accountId: account.id, status: { in: ['ordered', 'shipped', 'delivered'] } } }),
      app.db.order.count({ where: { accountId: account.id, status: 'ordered', createdAt: { lt: handlingCutoff } } }),
      app.db.order.count({ where: { accountId: account.id } }),
      app.db.order.count({ where: { accountId: account.id, status: 'refunded' } }),
      app.db.message.count({ where: { accountId: account.id, direction: 'in', answered: false, kind: { in: ['return', 'cancel'] } } }),
    ]);

    const listingCounts = await app.db.listing.groupBy({ by: ['status'], where: { accountId: account.id }, _count: { _all: true } });
    const count = (s: string) => listingCounts.find((r) => r.status === s)?._count._all ?? 0;

    const awaiting = await app.db.order.aggregate({ where: { accountId: account.id, status: 'awaiting_supplier' }, _count: { _all: true }, _min: { createdAt: true } });

    const recentEvents = await app.db.event.findMany({ where: { accountId: account.id }, orderBy: { at: 'desc' }, take: 25 });

    return {
      float: { outstandingCents, byOrder },
      today: { orders: todayOrders.length, revenueCents, profitCents, supplierSpendCents, spendCapCents: account.dailySpendCapCents },
      health: {
        lateShipmentPct: shippedOrOrdered === 0 ? 0 : late / shippedOrOrdered,
        defectPct: total === 0 ? 0 : defects / total,
        casesOpen,
        thresholds: HEALTH_THRESHOLDS,
      },
      listings: { active: count('active'), paused: count('paused'), draft: count('draft'), blocked: count('blocked'), ended: count('ended') },
      // Orders waiting for the seller to buy them by hand never auto-cancel; oldestAt is when the oldest buyer paid.
      awaitingSupplier: { count: awaiting._count._all, ...(awaiting._min.createdAt ? { oldestAt: awaiting._min.createdAt.toISOString() } : {}) },
      recentEvents: recentEvents.map(serializeEvent),
    };
  });
}
