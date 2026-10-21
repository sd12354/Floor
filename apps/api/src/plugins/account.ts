import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { notFound } from '../errors.js';
import type { Account } from '../generated/prisma/client.js';

export const DEFAULT_ACCOUNT_ID = 'acc_demo';

declare module 'fastify' {
  interface FastifyRequest {
    accountId: string;
    /** Loads the account row, 404 if missing. Cached per request. */
    account(): Promise<Account>;
  }
}

/** Single-tenant dev auth: X-Account-Id header (default acc_demo). */
export const accountPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('accountId', '');
  app.decorateRequest('account', function account(this: { accountId: string; _account?: Promise<Account> }) {
    if (!this._account) {
      const id = this.accountId;
      this._account = app.db.account.findUnique({ where: { id } }).then((a) => {
        if (!a) throw notFound('Account', id);
        return a;
      });
    }
    return this._account;
  });
  app.addHook('onRequest', async (req) => {
    const raw = req.headers['x-account-id'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    req.accountId = id && id.trim() !== '' ? id.trim() : DEFAULT_ACCOUNT_ID;
  });
}, { name: 'account', dependencies: ['prisma'] });
