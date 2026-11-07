import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { writeEvent } from '../services/audit.js';

/**
 * eBay Marketplace Account Deletion/Closure notifications.
 *
 * eBay requires a production keyset to have a reachable https endpoint that:
 *  - answers a GET challenge: return { challengeResponse: sha256(challengeCode + verificationToken + endpoint) } as hex;
 *  - accepts the POST notification and acknowledges with 2xx immediately.
 *
 * The verification token and the exact endpoint URL registered in the eBay portal come from config
 * (EBAY_DELETION_TOKEN, EBAY_DELETION_ENDPOINT). The hash input order matters: challengeCode, then token, then endpoint.
 *
 * Floor stores no buyer PII beyond order shipping details, so on a deletion notice there is little to purge; we log the
 * event for the audit trail and acknowledge. Signature verification of the POST is not implemented (eBay treats it as
 * recommended, not required to pass endpoint validation); see CONTRACT.md known gaps.
 */
export async function ebayDeletionRoutes(app: FastifyInstance): Promise<void> {
  // GET challenge validation.
  app.get<{ Querystring: { challenge_code?: string } }>(
    '/webhooks/ebay/account-deletion',
    { config: { public: true } },
    async (req, reply) => {
      const challengeCode = req.query.challenge_code;
      const token = app.config.ebayDeletionToken;
      const endpoint = app.config.ebayDeletionEndpoint;
      if (!challengeCode) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing challenge_code' } });
      if (!token || !endpoint) {
        return reply.code(503).send({
          error: { code: 'NOT_CONFIGURED', message: 'Set EBAY_DELETION_TOKEN and EBAY_DELETION_ENDPOINT to enable this endpoint.' },
        });
      }
      // Order matters: challengeCode + verificationToken + endpoint.
      const challengeResponse = createHash('sha256').update(challengeCode).update(token).update(endpoint).digest('hex');
      // Build JSON with the serializer (no hand-written body → no BOM).
      return reply.code(200).header('content-type', 'application/json').send({ challengeResponse });
    },
  );

  // POST notification: acknowledge immediately with 200, then record it.
  app.post('/webhooks/ebay/account-deletion', { config: { public: true } }, async (req, reply) => {
    void reply.code(200).send({ ok: true });
    try {
      const body = (req.body ?? {}) as { notification?: { notificationId?: string; data?: { username?: string; userId?: string } } };
      const n = body.notification;
      const account = await app.db.account.findFirst();
      if (account) {
        await writeEvent(app.db, {
          accountId: account.id,
          type: 'ebay.account_deletion',
          payload: { notificationId: n?.notificationId, username: n?.data?.username, userId: n?.data?.userId },
        });
      }
    } catch (err) {
      req.log.error({ err }, 'account-deletion notification post-ack handling failed');
    }
    return reply;
  });
}
