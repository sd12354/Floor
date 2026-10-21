import { isAllowedSupplier, NotConfiguredError, SUPPLIER_ALLOWLIST } from '@floor/core';
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

export async function supplierRoutes(app: FastifyInstance): Promise<void> {
  app.post('/suppliers', async (req, reply) => {
    const account = await req.account();
    const body = parse(createSchema, req.body ?? {});
    if (!isAllowedSupplier(body.supplier)) {
      throw unprocessable('SUPPLIER_NOT_ALLOWED', `Supplier must be one of ${SUPPLIER_ALLOWLIST.join(', ')}`);
    }
    if (app.config.mode === 'mock' && body.supplier !== 'mock') {
      throw unprocessable('SUPPLIER_NOT_AVAILABLE', 'Only the mock supplier is available in mock mode');
    }
    if (app.config.mode === 'real' && body.supplier === 'mock') {
      throw unprocessable('SUPPLIER_NOT_AVAILABLE', 'The mock supplier is not available in real mode');
    }

    let status: 'connected' | 'error' | 'not_configured' = 'connected';
    let cached = 0;
    try {
      cached = await cacheSupplierCatalog(app.db, app.connectors, body.supplier);
    } catch (err) {
      status = err instanceof NotConfiguredError ? 'not_configured' : 'error';
      req.log.warn({ err }, 'supplier catalog fetch failed');
    }

    const label = body.supplier === 'mock' ? 'Mock supplier (demo)' : body.supplier === 'cjdropshipping' ? 'CJdropshipping' : 'Spocket';
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
