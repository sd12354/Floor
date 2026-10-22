import type { FastifyInstance } from 'fastify';
import { MAX_AD_RATE_PCT, MIN_AD_RATE_PCT, RealEbay, effectiveVariablePct, normalizeAdRate } from '@floor/core';
import { z } from 'zod';
import { badRequest } from '../errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { parse } from '../plugins/validate.js';
import { asFees, asPricingRule, serializeAccount } from '../serialize.js';
import { writeEvent } from '../services/audit.js';
import { beginEbayConnect } from '../services/ebayOAuth.js';
import { effectiveFees } from '../services/pricingService.js';
import { countAdsPending } from '../services/promotedAds.js';
import { runSync } from '../services/syncService.js';

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
  promotedAdsEnabled: z.boolean().optional(),
  // 0.02 = 2%. eBay's range; sub-0.1% steps are rounded because eBay takes one decimal of a percent.
  promotedAdRatePct: z.number().min(MIN_AD_RATE_PCT, `Ad rate must be at least ${MIN_AD_RATE_PCT * 100}%`).max(MAX_AD_RATE_PCT).optional(),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const load = async (accountId: string) => {
    const account = await app.db.account.findUniqueOrThrow({ where: { id: accountId }, include: { supplierConnections: true } });
    // The stored flag can be left over from mock mode (demo_seller). In real mode "connected" means we hold an eBay token.
    const ebay = app.connectors.ebay;
    const stale = app.config.mode === 'real' && account.ebayConnected && ebay instanceof RealEbay && !(await ebay.hasCredentials());
    const shown = stale ? { ...account, ebayConnected: false, ebayUsername: null } : account;
    return serializeAccount(shown, { supplierConnections: account.supplierConnections, mode: app.config.mode, promotedAdsPending: await countAdsPending(app.db, account) });
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
    const nextEnabled = body.promotedAdsEnabled ?? account.promotedAdsEnabled;
    const nextRate = body.promotedAdRatePct !== undefined ? normalizeAdRate(body.promotedAdRatePct) : account.promotedAdRatePct;
    const nextFees = effectiveFees({ fees: body.fees ? { ...asFees(account.fees), ...body.fees } : account.fees, promotedAdsEnabled: nextEnabled, promotedAdRatePct: nextRate });
    if (nextEnabled && 1 - effectiveVariablePct(nextFees) - (nextRule ?? asPricingRule(account.pricingRule)).targetPct <= 0) {
      throw badRequest('That ad rate is too high: eBay fees plus the ad rate would leave no room for your target margin. Lower the ad rate.');
    }
    const data: Prisma.AccountUpdateInput = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(nextRule ? { pricingRule: nextRule as unknown as Prisma.InputJsonValue } : {}),
      ...(body.fees ? { fees: asFees({ ...asFees(account.fees), ...body.fees }) as unknown as Prisma.InputJsonValue } : {}),
      ...(body.dailySpendCapCents !== undefined ? { dailySpendCapCents: body.dailySpendCapCents } : {}),
      ...(body.smallLossToleranceCents !== undefined ? { smallLossToleranceCents: body.smallLossToleranceCents } : {}),
      ...(body.handlingTimeDays !== undefined ? { handlingTimeDays: body.handlingTimeDays } : {}),
      ...(body.newSeller !== undefined ? { newSeller: body.newSeller } : {}),
      ...(body.promotedAdsEnabled !== undefined ? { promotedAdsEnabled: body.promotedAdsEnabled } : {}),
      ...(body.promotedAdRatePct !== undefined ? { promotedAdRatePct: normalizeAdRate(body.promotedAdRatePct) } : {}),
    };
    const updated = await app.db.account.update({ where: { id: account.id }, data });
    await writeEvent(app.db, { accountId: account.id, type: 'account.updated', payload: body });
    // The fee table (and so every price and floor) moved when ads were switched or, while on, re-rated: reprice live listings now.
    // A listing that can no longer clear its floor is paused by the sweep; the order pipeline re-checks the margin at purchase time regardless.
    const adFeesMoved = updated.promotedAdsEnabled !== account.promotedAdsEnabled || (updated.promotedAdsEnabled && updated.promotedAdRatePct !== account.promotedAdRatePct);
    if (adFeesMoved) {
      try {
        await runSync(app.db, app.connectors, updated, { feesMoved: true });
      } catch (err) {
        await writeEvent(app.db, { accountId: account.id, type: 'sync.failed', payload: { reason: 'promoted_ads_reprice', message: err instanceof Error ? err.message : String(err) } });
      }
    }
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
