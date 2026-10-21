import type { SupplierProduct } from '@floor/core';
import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import type { Prisma, Product } from '../generated/prisma/client.js';
import { id } from './audit.js';

/** Upsert one supplier product into the Product cache. */
export async function cacheProduct(db: Db, p: SupplierProduct): Promise<Product> {
  const data = {
    title: p.title,
    description: p.description,
    images: p.images as Prisma.InputJsonValue,
    costCents: p.costCents,
    shippingCents: p.shippingCents,
    stock: p.stock,
    warehouseCountry: p.warehouseCountry,
    handlingDays: p.handlingDays,
    brand: p.brand ?? null,
    categoryHint: p.categoryHint ?? null,
  };
  return db.product.upsert({
    where: { supplier_supplierSku: { supplier: p.supplier, supplierSku: p.supplierSku } },
    create: { id: id('prd'), supplier: p.supplier, supplierSku: p.supplierSku, ...data },
    update: data,
  });
}

/** Pull the whole catalog for one supplier into the cache. Returns the number cached. */
export async function cacheSupplierCatalog(db: Db, connectors: Connectors, supplier: string): Promise<number> {
  const connector = connectors.supplier(supplier);
  let page = 1;
  let count = 0;
  for (;;) {
    const res = await connector.listCatalog({ page, pageSize: 100 });
    for (const p of res.items) {
      await cacheProduct(db, p);
      count += 1;
    }
    if (page * 100 >= res.total || res.items.length === 0) break;
    page += 1;
  }
  return count;
}

/** Refresh cost/stock for a set of products from the supplier, writing back to the cache. */
export async function refreshProducts(db: Db, connectors: Connectors, products: Product[]): Promise<Map<string, Product>> {
  const out = new Map<string, Product>();
  const bySupplier = new Map<string, Product[]>();
  for (const p of products) {
    const list = bySupplier.get(p.supplier) ?? [];
    list.push(p);
    bySupplier.set(p.supplier, list);
  }
  for (const [supplier, list] of bySupplier) {
    const connector = connectors.supplier(supplier);
    const fresh = await connector.getStockAndPrice(list.map((p) => p.supplierSku));
    const freshBySku = new Map(fresh.map((f) => [f.supplierSku, f]));
    for (const p of list) {
      const f = freshBySku.get(p.supplierSku);
      if (!f) {
        out.set(p.id, p);
        continue;
      }
      const changed = f.costCents !== p.costCents || f.shippingCents !== p.shippingCents || f.stock !== p.stock;
      const updated = changed
        ? await db.product.update({ where: { id: p.id }, data: { costCents: f.costCents, shippingCents: f.shippingCents, stock: f.stock } })
        : p;
      out.set(p.id, updated);
    }
  }
  return out;
}
