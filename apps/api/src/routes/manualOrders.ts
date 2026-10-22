import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../plugins/validate.js';
import { serializeOrder } from '../serialize.js';
import { markManualDelivered, quoteSupplier, recordManualTracking, recordSupplierOrder } from '../services/manualFulfillment.js';

/** Upper bound for any money field: $1,000,000. Keeps sums and fee maths far inside the safe integer range. */
const MAX_CENTS = 100_000_000;

const quoteSchema = z.object({ costCents: z.number().int().min(0).max(MAX_CENTS), shippingCents: z.number().int().min(0).max(MAX_CENTS) });
const supplierOrderSchema = z.object({
  supplierOrderId: z.string().trim().min(1).max(100),
  costCents: z.number().int().min(1).max(MAX_CENTS),
  shippingCents: z.number().int().min(0).max(MAX_CENTS),
  confirmBelowFloor: z.boolean().optional(),
});
const trackingSchema = z.object({ trackingNumber: z.string().trim().min(1).max(60), carrier: z.string().trim().min(1).max(40) });

/** Seller-driven fulfilment of orders for manual-supplier products. See "Manual supplier (v1.3)" in CONTRACT.md. */
export async function manualOrderRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/orders/:id/supplier-quote', async (req) => {
    const account = await req.account();
    const body = parse(quoteSchema, req.body ?? {});
    return quoteSupplier(app.db, account, req.params.id, body.costCents, body.shippingCents);
  });

  app.post<{ Params: { id: string } }>('/orders/:id/supplier-order', async (req) => {
    const account = await req.account();
    const body = parse(supplierOrderSchema, req.body ?? {});
    return serializeOrder(await recordSupplierOrder(app.db, app.connectors, account, req.params.id, body));
  });

  app.post<{ Params: { id: string } }>('/orders/:id/tracking', async (req) => {
    const account = await req.account();
    const body = parse(trackingSchema, req.body ?? {});
    return serializeOrder(await recordManualTracking(app.db, app.connectors, account, req.params.id, body.trackingNumber, body.carrier));
  });

  app.post<{ Params: { id: string } }>('/orders/:id/delivered', async (req) => {
    const account = await req.account();
    return serializeOrder(await markManualDelivered(app.db, app.connectors, account, req.params.id));
  });
}
