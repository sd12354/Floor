import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../plugins/validate.js';
import { mockSetup, runSetup } from '../services/ebaySetup.js';

const trimmed = (max: number) => z.string().trim().min(1).max(max);

const bodySchema = z.object({
  location: z.object({
    addressLine1: trimmed(128),
    city: trimmed(64),
    stateOrProvince: trimmed(64),
    postalCode: trimmed(16),
    // eBay policies and categories are set up for EBAY_US only.
    country: z.literal('US'),
  }),
  categoryQuery: z.string().trim().max(100).optional(),
  shippingCarrierCode: trimmed(40).optional(),
  shippingServiceCode: trimmed(60).optional(),
});

export async function ebaySetupRoutes(app: FastifyInstance): Promise<void> {
  app.post('/account/ebay/setup', async (req) => {
    const account = await req.account();
    const body = parse(bodySchema, req.body ?? {});
    const input = { ...body, categoryQuery: body.categoryQuery || undefined };
    if (app.config.mode === 'mock') return mockSetup(input);
    return runSetup(app.db, app.connectors, account.id, input);
  });
}
