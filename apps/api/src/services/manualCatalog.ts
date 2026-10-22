import type { CatalogPage, CatalogQuery, ManualProductLookup, SupplierProduct } from '@floor/core';
import type { Db } from '../db/client.js';
import type { Product } from '../generated/prisma/client.js';
import { asImages } from '../serialize.js';

export function toSupplierProduct(p: Product): SupplierProduct {
  return {
    supplier: 'manual',
    supplierSku: p.supplierSku,
    title: p.title,
    description: p.description,
    images: asImages(p.images),
    costCents: p.costCents,
    shippingCents: p.shippingCents,
    stock: p.stock,
    warehouseCountry: p.warehouseCountry,
    handlingDays: p.handlingDays,
    ...(p.brand ? { brand: p.brand } : {}),
    ...(p.categoryHint ? { categoryHint: p.categoryHint } : {}),
  };
}

/**
 * Manual products live in the Product table; the connector reads them through this lookup. The database
 * is bound after construction (see Connectors.bindDb) because connectors are built before the db is opened in some paths.
 */
export class ProductTableLookup implements ManualProductLookup {
  private db: Db | null = null;

  bind(db: Db): void {
    this.db = db;
  }

  private get client(): Db {
    if (!this.db) throw new Error('Manual supplier lookup used before a database was bound');
    return this.db;
  }

  async find(supplierSku: string): Promise<SupplierProduct | null> {
    const p = await this.client.product.findUnique({ where: { supplier_supplierSku: { supplier: 'manual', supplierSku } } });
    return p ? toSupplierProduct(p) : null;
  }

  async findMany(supplierSkus: readonly string[]): Promise<SupplierProduct[]> {
    const rows = await this.client.product.findMany({ where: { supplier: 'manual', supplierSku: { in: [...supplierSkus] } } });
    return rows.map(toSupplierProduct);
  }

  async list(query: CatalogQuery): Promise<CatalogPage> {
    const where = {
      supplier: 'manual',
      ...(query.q ? { title: { contains: query.q } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.client.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.client.product.count({ where }),
    ]);
    return { items: rows.map(toSupplierProduct), total };
  }
}
