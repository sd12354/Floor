import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../errors.js';
import { parse } from '../plugins/validate.js';
import { serializeOrder } from '../serialize.js';
import { intakeOrder, processOrder } from '../services/orderPipeline.js';

const addressSchema = z.object({
  name: z.string().optional(),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(2).max(2),
});

/**
 * Normalised eBay order notification. In real mode the eBay Notification API payload is mapped to this
 * shape (lineItems[0].legacyItemId -> listing.ebayItemId, pricingSummary -> cents) by the real adapter.
 */
const ebayOrderSchema = z.object({
  ebayOrderId: z.string().min(1),
  /** Either the Floor listing id or the eBay item id. */
  listingId: z.string().min(1).optional(),
  ebayItemId: z.string().min(1).optional(),
  buyerName: z.string().min(1),
  shipTo: addressSchema,
  salePriceCents: z.number().int().min(1),
  buyerShippingCents: z.number().int().min(0).default(0),
  createdAt: z.string().datetime().optional(),
});

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/ebay', async (req, reply) => {
    const account = await req.account();
    const body = parse(ebayOrderSchema, req.body ?? {});
    const listing = body.listingId
      ? await app.db.listing.findFirst({ where: { id: body.listingId, accountId: account.id } })
      : body.ebayItemId
        ? await app.db.listing.findFirst({ where: { ebayItemId: body.ebayItemId, accountId: account.id } })
        : null;
    if (!listing) throw notFound('Listing', body.listingId ?? body.ebayItemId);

    const { order, created } = await intakeOrder(app.db, account, {
      ebayOrderId: body.ebayOrderId,
      listingId: listing.id,
      buyerName: body.buyerName,
      shipTo: body.shipTo,
      salePriceCents: body.salePriceCents,
      buyerShippingCents: body.buyerShippingCents,
      ...(body.createdAt ? { createdAt: new Date(body.createdAt) } : {}),
    });
    if (!created) {
      // Duplicate notification: no-op, report the existing state.
      return reply.code(200).send({ duplicate: true, order: serializeOrder(order) });
    }
    const processed = await processOrder(app.db, app.connectors, account, order.id);
    return reply.code(201).send({ duplicate: false, order: serializeOrder(processed) });
  });
}
