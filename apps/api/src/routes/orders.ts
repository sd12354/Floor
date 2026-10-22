import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { notFound, unprocessable } from '../errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { pagination, parse } from '../plugins/validate.js';
import { serializeEvent, serializeLedger, serializeMessage, serializeOrder } from '../serialize.js';
import { manualOrderExtras } from '../services/manualFulfillment.js';
import { cancelOrder, fulfilHeldOrder, intakeOrder, processOrder } from '../services/orderPipeline.js';

const decisionSchema = z.object({ action: z.enum(['fulfil', 'cancel']) });
const simulateSchema = z.object({
  listingId: z.string().min(1),
  buyerName: z.string().min(1).max(80).optional(),
  priceDriftPct: z.number().min(-90).max(500).optional(),
  /** Optional override of the sale price (defaults to the listing price). */
  salePriceCents: z.number().int().min(1).optional(),
});

interface ListQuery {
  status?: string;
  page?: string;
  pageSize?: string;
}

const DEMO_BUYERS = ['Alex Rivera', 'Jordan Lee', 'Sam Patel', 'Casey Nguyen', 'Taylor Brooks', 'Morgan Diaz'];
const DEMO_ADDRESS = { line1: '742 Evergreen Terrace', city: 'Springfield', state: 'IL', postalCode: '62704', country: 'US' };

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/orders', async (req) => {
    const account = await req.account();
    const { page, pageSize, skip } = pagination(req.query, 200);
    const where: Prisma.OrderWhereInput = { accountId: account.id, ...(req.query.status ? { status: req.query.status } : {}) };
    const [rows, total] = await Promise.all([
      app.db.order.findMany({ where, include: { listing: { select: { title: true } } }, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      app.db.order.count({ where }),
    ]);
    return { items: rows.map((o) => ({ ...serializeOrder(o), listing: { title: o.listing.title } })), total, page, pageSize };
  });

  app.get<{ Params: { id: string } }>('/orders/:id', async (req) => {
    const account = await req.account();
    const o = await app.db.order.findFirst({
      where: { id: req.params.id, accountId: account.id },
      include: {
        listing: { select: { title: true, product: true } },
        events: { orderBy: { at: 'asc' } },
        messages: { orderBy: { at: 'asc' } },
        ledger: { orderBy: { at: 'asc' } },
      },
    });
    if (!o) throw notFound('Order', req.params.id);
    return {
      ...serializeOrder(o),
      listing: { title: o.listing.title },
      ...manualOrderExtras(o, o.listing.product, account),
      events: o.events.map(serializeEvent),
      messages: o.messages.map(serializeMessage),
      ledger: o.ledger.map(serializeLedger),
    };
  });

  app.post<{ Params: { id: string } }>('/orders/:id/decision', async (req) => {
    const account = await req.account();
    const body = parse(decisionSchema, req.body ?? {});
    const order = await app.db.order.findFirst({ where: { id: req.params.id, accountId: account.id } });
    if (!order) throw notFound('Order', req.params.id);
    // Held orders accept fulfil or cancel; manual orders waiting for the seller accept cancel only.
    const cancellable = order.status === 'held' || (order.status === 'awaiting_supplier' && body.action === 'cancel');
    if (!cancellable) throw unprocessable('ORDER_NOT_HELD', `Order is ${order.status}, decisions apply to held orders (and cancel for orders awaiting the supplier)`);
    const updated =
      body.action === 'fulfil'
        ? await fulfilHeldOrder(app.db, app.connectors, account, order.id)
        : await cancelOrder(app.db, app.connectors, account, order.id, 'manual', { decision: { action: 'cancel', reason: 'manual' } });
    return serializeOrder(updated);
  });

  app.post('/orders/simulate', async (req, reply) => {
    const account = await req.account();
    if (app.config.mode !== 'mock' || !app.connectors.mockSupplier) {
      throw unprocessable('MOCK_ONLY', 'Order simulation is only available in mock mode');
    }
    const body = parse(simulateSchema, req.body ?? {});
    const listing = await app.db.listing.findFirst({ where: { id: body.listingId, accountId: account.id }, include: { product: true } });
    if (!listing) throw notFound('Listing', body.listingId);
    if (listing.status !== 'active') throw unprocessable('LISTING_NOT_ACTIVE', 'Only active listings receive orders');

    if (body.priceDriftPct !== undefined && body.priceDriftPct !== 0) {
      const costCents = Math.max(1, Math.round(listing.product.costCents * (1 + body.priceDriftPct / 100)));
      // Manual products have no remote source: the seller's own row is the price.
      if (listing.product.supplier === 'manual') await app.db.product.update({ where: { id: listing.product.id }, data: { costCents } });
      else app.connectors.mockSupplier.setSku(listing.product.supplierSku, { costCents });
    }
    const { order } = await intakeOrder(app.db, account, {
      ebayOrderId: `sim-${nanoid(8)}`,
      listingId: listing.id,
      buyerName: body.buyerName ?? DEMO_BUYERS[Math.floor(Math.random() * DEMO_BUYERS.length)] ?? 'Demo Buyer',
      shipTo: { ...DEMO_ADDRESS, name: body.buyerName ?? 'Demo Buyer' },
      salePriceCents: body.salePriceCents ?? listing.priceCents,
      buyerShippingCents: listing.buyerShippingCents,
    });
    const processed = await processOrder(app.db, app.connectors, account, order.id);
    return reply.code(201).send({ ...serializeOrder(processed), listing: { title: listing.title } });
  });
}
