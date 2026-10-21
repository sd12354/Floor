import type { FastifyInstance } from 'fastify';
import { badRequest } from '../errors.js';
import type { LedgerEntry, Prisma } from '../generated/prisma/client.js';
import { serializeLedger } from '../serialize.js';

interface RangeQuery {
  from?: string;
  to?: string;
}

function parseRange(q: RangeQuery): Prisma.LedgerEntryWhereInput['at'] {
  const at: { gte?: Date; lte?: Date } = {};
  if (q.from) {
    const d = new Date(q.from);
    if (Number.isNaN(d.getTime())) throw badRequest('Invalid from date');
    at.gte = d;
  }
  if (q.to) {
    const d = new Date(q.to);
    if (Number.isNaN(d.getTime())) throw badRequest('Invalid to date');
    at.lte = d;
  }
  return Object.keys(at).length ? at : undefined;
}

export function ledgerTotals(entries: LedgerEntry[]) {
  const sum = (kinds: string[]) => entries.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.amountCents, 0);
  const revenueCents = sum(['sale', 'refund']);
  const feesCents = -sum(['ebay_fee']);
  const costCents = -sum(['supplier_cost', 'supplier_shipping']);
  const payoutCents = sum(['payout']);
  return { revenueCents, feesCents, costCents, profitCents: revenueCents - feesCents - costCents, payoutCents };
}

const csvEscape = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function ledgerRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: RangeQuery }>('/ledger', async (req) => {
    const account = await req.account();
    const at = parseRange(req.query);
    const entries = await app.db.ledgerEntry.findMany({ where: { accountId: account.id, ...(at ? { at } : {}) }, orderBy: { at: 'desc' } });
    return { entries: entries.map(serializeLedger), totals: ledgerTotals(entries) };
  });

  app.get<{ Querystring: RangeQuery }>('/ledger/export.csv', async (req, reply) => {
    const account = await req.account();
    const at = parseRange(req.query);
    const entries = await app.db.ledgerEntry.findMany({ where: { accountId: account.id, ...(at ? { at } : {}) }, orderBy: { at: 'asc' } });
    const lines = ['id,at,kind,orderId,amountCents,amountUsd'];
    for (const e of entries) {
      lines.push([e.id, e.at.toISOString(), e.kind, e.orderId ?? '', e.amountCents, (e.amountCents / 100).toFixed(2)].map(csvEscape).join(','));
    }
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="floor-ledger-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(`${lines.join('\n')}\n`);
  });
}
