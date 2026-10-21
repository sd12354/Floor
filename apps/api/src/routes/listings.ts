import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { pagination, parse } from '../plugins/validate.js';
import { serializeListing, serializeProduct } from '../serialize.js';
import { createDrafts, patchListing, publishListings } from '../services/listingService.js';
import { runSync } from '../services/syncService.js';

const createSchema = z.object({ productIds: z.array(z.string().min(1)).min(1).max(200) });
const patchSchema = z.object({
  title: z.string().min(3).max(80).optional(),
  priceCents: z.number().int().min(1).optional(),
  status: z.enum(['active', 'paused']).optional(),
});
const publishSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });

interface ListQuery {
  status?: string;
  q?: string;
  page?: string;
  pageSize?: string;
}

export async function listingRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListQuery }>('/listings', async (req) => {
    const account = await req.account();
    const { page, pageSize, skip } = pagination(req.query, 200);
    const where: Prisma.ListingWhereInput = {
      accountId: account.id,
      ...(req.query.status ? { status: req.query.status } : {}),
      ...(req.query.q ? { title: { contains: req.query.q } } : {}),
    };
    const [rows, total] = await Promise.all([
      app.db.listing.findMany({ where, include: { product: true }, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
      app.db.listing.count({ where }),
    ]);
    return { items: rows.map((l) => ({ ...serializeListing(l), product: serializeProduct(l.product) })), total, page, pageSize };
  });

  app.post('/listings', async (req, reply) => {
    const account = await req.account();
    const body = parse(createSchema, req.body ?? {});
    const res = await createDrafts(app.db, account, body.productIds);
    return reply.code(201).send({ created: res.created.map(serializeListing), blocked: res.blocked });
  });

  app.patch<{ Params: { id: string } }>('/listings/:id', async (req) => {
    const account = await req.account();
    const body = parse(patchSchema, req.body ?? {});
    const updated = await patchListing(app.db, app.connectors, account, req.params.id, body);
    const product = await app.db.product.findUniqueOrThrow({ where: { id: updated.productId } });
    return { ...serializeListing(updated), product: serializeProduct(product) };
  });

  app.post('/listings/publish', async (req) => {
    const account = await req.account();
    const body = parse(publishSchema, req.body ?? {});
    const res = await publishListings(app.db, app.connectors, account, body.ids);
    return { published: res.published.map(serializeListing), blocked: res.blocked };
  });

  app.post('/listings/sync', async (req) => {
    const account = await req.account();
    const res = await runSync(app.db, app.connectors, account);
    return { repriced: res.repriced, paused: res.paused, resumed: res.resumed, checked: res.checked, blocked: res.blocked };
  });
}
