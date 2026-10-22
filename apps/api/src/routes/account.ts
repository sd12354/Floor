import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { parse } from '../plugins/validate.js';
import { asFees, asPricingRule, serializeAccount } from '../serialize.js';
import { writeEvent } from '../services/audit.js';
import { beginEbayConnect } from '../services/ebayOAuth.js';

const feesSchema = z.object({
  finalValueFeePct: z.number().min(0).max(1).optional(),
  perOrderFeeCents: z.number().int().min(0).optional(),
  promotedPct: z.number().min(0).max(1).optional(),
  storeDiscountPct: z.number().min(0).max(1).optional(),
  topRatedDiscountPct: z.number().min(0).max(1).optional(),
  belowStandardSurchargePct: z.number().min(0).max(1).optional(),
});

const pricingRuleSchema = z.object({
  floorPct: z.number().min(-1).max(0.9).optional(),
  targetPct: z.number().min(-1).max(0.9).optional(),
  roundTo: z.enum(['none', '0.99', '0.95']).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  pricingRule: pricingRuleSchema.optional(),
  fees: feesSchema.optional(),
  dailySpendCapCents: z.number().int().min(0).optional(),
  smallLossToleranceCents: z.number().int().min(0).optional(),
  handlingTimeDays: z.number().int().min(1).max(30).optional(),
  newSeller: z.boolean().optional(),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const load = async (accountId: string) => {
    const account = await app.db.account.findUniqueOrThrow({ where: { id: accountId }, include: { supplierConnections: true } });
    return serializeAccount(account, { supplierConnections: account.supplierConnections, mode: app.config.mode });
  };

  app.get('/account', async (req) => {
    await req.account();
    return load(req.accountId);
  });

  app.patch('/account', async (req) => {
    const account = await req.account();
    const body = parse(patchSchema, req.body ?? {});
    const nextRule = body.pricingRule ? asPricingRule({ ...asPricingRule(account.pricingRule), ...body.pricingRule }) : undefined;
    if (nextRule && nextRule.targetPct < nextRule.floorPct) throw badRequest('targetPct must be >= floorPct');
    const data: Prisma.AccountUpdateInput = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(nextRule ? { pricingRule: nextRule as unknown as Prisma.InputJsonValue } : {}),
      ...(body.fees ? { fees: asFees({ ...asFees(account.fees), ...body.fees }) as unknown as Prisma.InputJsonValue } : {}),
      ...(body.dailySpendCapCents !== undefined ? { dailySpendCapCents: body.dailySpendCapCents } : {}),
      ...(body.smallLossToleranceCents !== undefined ? { smallLossToleranceCents: body.smallLossToleranceCents } : {}),
      ...(body.handlingTimeDays !== undefined ? { handlingTimeDays: body.handlingTimeDays } : {}),
      ...(body.newSeller !== undefined ? { newSeller: body.newSeller } : {}),
    };
    await app.db.account.update({ where: { id: account.id }, data });
    await writeEvent(app.db, { accountId: account.id, type: 'account.updated', payload: body });
    return load(account.id);
  });

  app.post('/account/ebay/connect', async (req, reply) => {
    const account = await req.account();
    if (app.config.mode === 'mock') {
      await app.db.account.update({ where: { id: account.id }, data: { ebayConnected: true, ebayUsername: 'demo_seller' } });
      await writeEvent(app.db, { accountId: account.id, type: 'ebay.connected', payload: { username: 'demo_seller' } });
      return load(account.id);
    }
    return reply.send(await beginEbayConnect(app.db, app.connectors, app.config, account.id));
  });
}
