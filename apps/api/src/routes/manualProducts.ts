import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { notFound, unprocessable } from '../errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { parse } from '../plugins/validate.js';
import { serializeProduct } from '../serialize.js';
import { id, writeEvent } from '../services/audit.js';
import { runSync } from '../services/syncService.js';

const httpsUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https URL');

const title = z.string().trim().min(3).max(80);
const description = z.string().trim().min(1).max(20_000);
const images = z.array(httpsUrl).min(1).max(12);
const costCents = z.number().int().min(1);
const shippingCents = z.number().int().min(0);
const stock = z.number().int().min(0);
const handlingDays = z.number().int().min(1).max(60);
const country = z.string().regex(/^[A-Za-z]{2}$/, 'must be a 2-letter country code').transform((s) => s.toUpperCase());
const tag = z.string().trim().min(1).max(80);

const createSchema = z.object({
  title,
  description,
  images,
  costCents,
  shippingCents,
  stock,
  handlingDays,
  warehouseCountry: country.default('CN'),
  supplierUrl: httpsUrl.optional(),
  brand: tag.optional(),
  categoryHint: tag.optional(),
});

/** Any subset of the create fields; the optional text fields accept null to clear them. */
const patchSchema = z.object({
  title: title.optional(),
  description: description.optional(),
  images: images.optional(),
  costCents: costCents.optional(),
  shippingCents: shippingCents.optional(),
  stock: stock.optional(),
  handlingDays: handlingDays.optional(),
  warehouseCountry: country.optional(),
  supplierUrl: httpsUrl.nullable().optional(),
  brand: tag.nullable().optional(),
  categoryHint: tag.nullable().optional(),
});

/** Fields whose change can alter a live listing's price, stock or compliance, so the listing sweep re-runs. */
const SWEEP_FIELDS = ['costCents', 'shippingCents', 'stock', 'handlingDays', 'brand', 'categoryHint', 'images', 'title'] as const;

export async function manualProductRoutes(app: FastifyInstance): Promise<void> {
  app.get('/manual-products', async () => {
    const rows = await app.db.product.findMany({ where: { supplier: 'manual' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return { items: rows.map(serializeProduct), total: rows.length };
  });

  app.post('/manual-products', async (req, reply) => {
    const account = await req.account();
    const body = parse(createSchema, req.body ?? {});
    const conn = await app.db.supplierConnection.findFirst({ where: { accountId: account.id, supplier: 'manual', status: 'connected' } });
    if (!conn) throw unprocessable('SUPPLIER_NOT_CONNECTED', 'Connect the manual supplier before adding products');
    const product = await app.db.product.create({
      data: {
        id: id('prd'),
        supplier: 'manual',
        supplierSku: `man_${nanoid(12)}`,
        title: body.title,
        description: body.description,
        images: body.images as Prisma.InputJsonValue,
        costCents: body.costCents,
        shippingCents: body.shippingCents,
        stock: body.stock,
        warehouseCountry: body.warehouseCountry,
        handlingDays: body.handlingDays,
        supplierUrl: body.supplierUrl ?? null,
        brand: body.brand ?? null,
        categoryHint: body.categoryHint ?? null,
      },
    });
    await writeEvent(app.db, { accountId: account.id, type: 'product.created', payload: { productId: product.id, supplier: 'manual' } });
    return reply.code(201).send(serializeProduct(product));
  });

  app.patch<{ Params: { id: string } }>('/manual-products/:id', async (req) => {
    const account = await req.account();
    const body = parse(patchSchema, req.body ?? {});
    const existing = await app.db.product.findFirst({ where: { id: req.params.id, supplier: 'manual' } });
    if (!existing) throw notFound('Product', req.params.id);

    const data: Prisma.ProductUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.description !== undefined) data.description = body.description;
    if (body.images !== undefined) data.images = body.images as Prisma.InputJsonValue;
    if (body.costCents !== undefined) data.costCents = body.costCents;
    if (body.shippingCents !== undefined) data.shippingCents = body.shippingCents;
    if (body.stock !== undefined) data.stock = body.stock;
    if (body.handlingDays !== undefined) data.handlingDays = body.handlingDays;
    if (body.warehouseCountry !== undefined) data.warehouseCountry = body.warehouseCountry;
    if (body.supplierUrl !== undefined) data.supplierUrl = body.supplierUrl;
    if (body.brand !== undefined) data.brand = body.brand;
    if (body.categoryHint !== undefined) data.categoryHint = body.categoryHint;
    const product = Object.keys(data).length > 0 ? await app.db.product.update({ where: { id: existing.id }, data }) : existing;

    const moved = (body.costCents !== undefined && body.costCents !== existing.costCents) || (body.shippingCents !== undefined && body.shippingCents !== existing.shippingCents);
    const touched = SWEEP_FIELDS.some((f) => body[f] !== undefined && JSON.stringify(body[f]) !== JSON.stringify(existing[f]));
    if (touched) await runSync(app.db, app.connectors, account, { productId: product.id, costMoved: moved });
    await writeEvent(app.db, { accountId: account.id, type: 'product.updated', payload: { productId: product.id, fields: Object.keys(data) } });
    return serializeProduct(await app.db.product.findUniqueOrThrow({ where: { id: product.id } }));
  });

  app.delete<{ Params: { id: string } }>('/manual-products/:id', async (req, reply) => {
    const account = await req.account();
    const product = await app.db.product.findFirst({ where: { id: req.params.id, supplier: 'manual' } });
    if (!product) throw notFound('Product', req.params.id);
    const [live, orders] = await Promise.all([
      app.db.listing.count({ where: { productId: product.id, status: { not: 'draft' } } }),
      app.db.order.count({ where: { listing: { productId: product.id } } }),
    ]);
    if (live > 0 || orders > 0) {
      throw unprocessable('PRODUCT_IN_USE', 'This product has published listings or orders, so it cannot be removed', { listings: live, orders });
    }
    await app.db.$transaction(async (tx) => {
      await tx.listing.deleteMany({ where: { productId: product.id, status: 'draft' } });
      await tx.product.delete({ where: { id: product.id } });
    });
    await writeEvent(app.db, { accountId: account.id, type: 'product.deleted', payload: { productId: product.id, supplier: 'manual' } });
    return reply.code(204).send();
  });
}
