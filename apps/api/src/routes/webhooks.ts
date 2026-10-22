import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, notFound } from '../errors.js';
import { bearerToken } from '../plugins/auth.js';
import { parse } from '../plugins/validate.js';
import { serializeOrder } from '../serialize.js';
import { userForToken } from '../services/auth.js';
import { ingestEbayOrder } from '../services/ebayIngest.js';

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();

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

/**
 * Webhook callers authenticate with EITHER a session bearer token OR the shared secret in `X-Floor-Webhook-Secret`
 * (FLOOR_WEBHOOK_SECRET; compared in constant time; no secret configured means the header never authenticates).
 * eBay's X-EBAY-SIGNATURE scheme is not used here: it signs Notification API payloads (a different shape from this
 * normalised body), so it cannot verify requests to this route. See CONTRACT.md known gaps.
 */
async function authenticateWebhook(app: FastifyInstance, req: FastifyRequest): Promise<void> {
  const header = req.headers['x-floor-webhook-secret'];
  const supplied = Array.isArray(header) ? header[0] : header;
  if (supplied !== undefined) {
    const expected = app.config.webhookSecret;
    if (expected && timingSafeEqual(sha(supplied), sha(expected))) return;
    throw new AppError(401, 'UNAUTHENTICATED', 'Invalid webhook secret');
  }
  const token = bearerToken(req.headers.authorization);
  if (token && (await userForToken(app.db, token))) return;
  throw new AppError(401, 'UNAUTHENTICATED', 'Sign in or send X-Floor-Webhook-Secret');
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/ebay', { config: { public: true } }, async (req, reply) => {
    await authenticateWebhook(app, req);
    const account = await req.account();
    const body = parse(ebayOrderSchema, req.body ?? {});
    const listing = body.listingId
      ? await app.db.listing.findFirst({ where: { id: body.listingId, accountId: account.id } })
      : body.ebayItemId
        ? await app.db.listing.findFirst({ where: { ebayItemId: body.ebayItemId, accountId: account.id } })
        : null;
    if (!listing) throw notFound('Listing', body.listingId ?? body.ebayItemId);

    const result = await ingestEbayOrder(
      app.db,
      app.connectors,
      account,
      {
        ebayOrderId: body.ebayOrderId,
        ebayItemId: listing.ebayItemId ?? '',
        buyerName: body.buyerName,
        shipTo: body.shipTo,
        salePriceCents: body.salePriceCents,
        buyerShippingCents: body.buyerShippingCents,
        createdAt: body.createdAt ?? new Date().toISOString(),
      },
      { listingId: listing.id },
    );
    if (!result) throw notFound('Listing', listing.id);
    // Duplicate notification: no-op, report the existing state.
    if (!result.created) return reply.code(200).send({ duplicate: true, order: serializeOrder(result.order) });
    return reply.code(201).send({ duplicate: false, order: serializeOrder(result.order) });
  });
}
