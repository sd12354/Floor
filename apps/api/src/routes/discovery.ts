import type { FastifyInstance } from 'fastify';
import { notFound } from '../errors.js';
import type { Account, Prisma, Product } from '../generated/prisma/client.js';
import { pagination } from '../plugins/validate.js';
import { serializeProduct } from '../serialize.js';
import { accountPricing, gateProduct, generateTitle, loadBlockedBrands, projectPrice } from '../services/pricingService.js';

interface DiscoveryQuery {
  supplier?: string;
  q?: string;
  minMarginPct?: string;
  page?: string;
  pageSize?: string;
}

export function projectDiscoveryItem(product: Product, account: Account, blockedBrands: readonly string[], full: boolean) {
  const pricing = accountPricing(account);
  const compliance = gateProduct(product, pricing, blockedBrands, generateTitle(product.title, product.categoryHint));
  let projectedPriceCents = 0;
  let projectedMarginPct = 0;
  try {
    const proj = projectPrice(product, pricing);
    projectedPriceCents = proj.priceCents;
    projectedMarginPct = proj.projectedMarginPct;
  } catch {
    // unreachable target margin for this product; leave zeros
  }
  const base = serializeProduct(product);
  return {
    ...base,
    description: full ? base.description : base.description.slice(0, 160),
    projectedPriceCents,
    projectedMarginPct,
    compliance,
  };
}

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: DiscoveryQuery }>('/discovery', async (req) => {
    const account = await req.account();
    const { page, pageSize, skip } = pagination(req.query, 200);
    const connected = await app.db.supplierConnection.findMany({ where: { accountId: account.id }, select: { supplier: true } });
    const suppliers = connected.map((c) => c.supplier);
    const where: Prisma.ProductWhereInput = {
      supplier: req.query.supplier ? req.query.supplier : { in: suppliers },
      ...(req.query.q ? { OR: [{ title: { contains: req.query.q } }, { categoryHint: { contains: req.query.q } }, { brand: { contains: req.query.q } }] } : {}),
    };
    const blockedBrands = await loadBlockedBrands(app.db);
    const minMargin = req.query.minMarginPct !== undefined && req.query.minMarginPct !== '' ? Number(req.query.minMarginPct) : undefined;

    if (minMargin !== undefined && Number.isFinite(minMargin)) {
      // Margin is computed, not stored: filter in memory over the candidate set.
      const all = await app.db.product.findMany({ where, orderBy: { title: 'asc' } });
      const items = all.map((p) => projectDiscoveryItem(p, account, blockedBrands, false)).filter((i) => i.projectedMarginPct >= minMargin);
      return { items: items.slice(skip, skip + pageSize), total: items.length, page, pageSize };
    }
    const [rows, total] = await Promise.all([
      app.db.product.findMany({ where, orderBy: { title: 'asc' }, skip, take: pageSize }),
      app.db.product.count({ where }),
    ]);
    return { items: rows.map((p) => projectDiscoveryItem(p, account, blockedBrands, false)), total, page, pageSize };
  });

  app.get<{ Params: { productId: string } }>('/discovery/:productId', async (req) => {
    const account = await req.account();
    const product = await app.db.product.findUnique({ where: { id: req.params.productId } });
    if (!product) throw notFound('Product', req.params.productId);
    const blockedBrands = await loadBlockedBrands(app.db);
    return projectDiscoveryItem(product, account, blockedBrands, true);
  });
}
