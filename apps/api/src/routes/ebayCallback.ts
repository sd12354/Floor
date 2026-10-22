import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { parse } from '../plugins/validate.js';
import { writeEvent } from '../services/audit.js';
import { completeEbayConnect, consumeState } from '../services/ebayOAuth.js';

const querySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().optional(),
  error: z.string().max(200).optional(),
});

/**
 * eBay redirects the seller's browser here after consent. It is the only unauthenticated route besides auth, so it
 * trusts nothing but the single-use `state` minted by POST /account/ebay/connect (which names the account). A bad,
 * expired or replayed state is a 400 and nothing is stored. Success and a denied consent redirect to the web app.
 */
export async function ebayCallbackRoutes(app: FastifyInstance): Promise<void> {
  app.get('/account/ebay/callback', { config: { public: true } }, async (req, reply) => {
    if (app.config.mode !== 'real') throw new AppError(422, 'REAL_ONLY', 'eBay OAuth is only available in real mode');
    const q = parse(querySchema, req.query ?? {});
    const accountId = await consumeState(app.db, q.state);
    const back = (result: string) => reply.redirect(`${app.config.webOrigin.replace(/\/$/, '')}/settings?ebay=${result}`);
    if (q.error || !q.code) {
      await writeEvent(app.db, { accountId, type: 'ebay.connect_denied', payload: { error: q.error ?? 'no_code' } });
      return back('denied');
    }
    try {
      await completeEbayConnect(app.db, app.connectors, app.config, accountId, q.code);
    } catch (err) {
      req.log.error({ err }, 'eBay connect failed');
      await writeEvent(app.db, { accountId, type: 'ebay.connect_failed', payload: { error: err instanceof Error ? err.message : 'unknown' } });
      return back('failed');
    }
    return back('connected');
  });
}
