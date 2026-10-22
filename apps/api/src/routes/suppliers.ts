import { isAllowedSupplier, NotConfiguredError, SUPPLIER_ALLOWLIST, type Supplier } from '@floor/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound, unprocessable } from '../errors.js';
import { parse } from '../plugins/validate.js';
import { serializeSupplierConnection } from '../serialize.js';
import { id, writeEvent } from '../services/audit.js';
import { cacheSupplierCatalog } from '../services/catalog.js';

const createSchema = z.object({
  supplier: z.string(),
  credentials: z.record(z.string(), z.string()).optional(),
});

const SUPPLIER_LABELS: Record<Supplier, string> = {
  mock: 'Mock supplier (demo)',
  cjdropshipping: 'CJdropshipping',
  spocket: 'Spocket',
  manual: 'Manual supplier (Alibaba, CJ, any wholesaler)',
};

export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.post('/suppliers', async (req, reply) => {
    const account = await req.account();
    const body = parse(createSchema, req.body ?? {});
    if (!isAllowedSupplier(body.supplier)) {
      throw unprocessable('SUPPLIER_NOT_ALLOWED', `Supplier must be one of ${SUPPLIER_ALLOWLIST.join(', ')}`);
    }
    // 'manual' is the one supplier that works in both modes; the others follow the mode.
    if (body.supplier !== 'manual') {
      if (app.config.mode === 'mock' && body.supplier !== 'mock') {
        throw unprocessable('SUPPLIER_NOT_AVAILABLE', 'Only the mock and manual suppliers are available in mock mode');
      }
      if (app.config.mode === 'real' && body.supplier === 'mock') {
        throw unprocessable('SUPPLIER_NOT_AVAILABLE', 'The mock supplier is not available in real mode');
      }
    }

    let status: 'connected' | 'error' | 'not_configured' = 'connected';
    let cached = 0;
    try {
      // The manual catalog is the Product table itself: nothing to pull.
      if (body.supplier !== 'manual') cached = await cacheSupplierCatalog(app.db, app.connectors, body.supplier);
    } catch (err) {
      status = err instanceof NotConfiguredError ? 'not_configured' : 'error';
      req.log.warn({ err }, 'supplier catalog fetch failed');
    }

    const label = SUPPLIER_LABELS[body.supplier];
    const conn = await app.db.supplierConnection.upsert({
      where: { accountId_supplier: { accountId: account.id, supplier: body.supplier } },
      create: { id: id('sup'), accountId: account.id, supplier: body.supplier, status, label },
      update: { status, label },
    });
    await writeEvent(app.db, { accountId: account.id, type: 'supplier.connected', payload: { supplier: body.supplier, status, cached } });
    return reply.code(201).send(serializeSupplierConnection(conn));
  });

  app.delete<{ Params: { id: string } }>('/suppliers/:id', async (req, reply) => {
    const account = await req.account();
    const conn = await app.db.supplierConnection.findFirst({ where: { id: req.params.id, accountId: account.id } });
    if (!conn) throw notFound('SupplierConnection', req.params.id);
    await app.db.supplierConnection.delete({ where: { id: conn.id } });
    await writeEvent(app.db, { accountId: account.id, type: 'supplier.disconnected', payload: { supplier: conn.supplier } });
    return reply.code(204).send();
  });
}
