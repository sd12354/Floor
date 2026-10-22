import type { EbayTokens, TokenStore } from '@floor/core';
import type { Db } from '../db/client.js';
import { decryptSecret, encryptSecret } from './secretBox.js';

/**
 * TokenStore backed by the EbayCredential table, encrypted with FLOOR_SECRET_KEY. Floor is single-seller, so
 * the store serves the one credential row. `set` refuses (NotConfiguredError) when the key is missing.
 * The connector is built before the db exists, hence `bind`.
 */
export class DbTokenStore implements TokenStore {
  private db: Db | null = null;

  constructor(private readonly secretKey: string | undefined, private readonly now: () => Date = () => new Date()) {}

  bind(db: Db): void {
    this.db = db;
  }

  private requireDb(): Db {
    if (!this.db) throw new Error('DbTokenStore: database not bound');
    return this.db;
  }

  async get(): Promise<EbayTokens | null> {
    const row = await this.requireDb().ebayCredential.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (!row) return null;
    const { accessToken, refreshToken } = JSON.parse(decryptSecret(row.ciphertext, this.secretKey)) as { accessToken: string; refreshToken: string };
    return { accessToken, refreshToken, expiresAt: row.accessExpiresAt, refreshExpiresAt: row.refreshExpiresAt };
  }

  /** Update tokens for the existing credential row (refresh), or create it for the sole account (first connect). */
  async set(tokens: EbayTokens): Promise<void> {
    const db = this.requireDb();
    const ciphertext = encryptSecret(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }), this.secretKey);
    const data = { ciphertext, accessExpiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt };
    const existing = await db.ebayCredential.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (existing) {
      await db.ebayCredential.update({ where: { accountId: existing.accountId }, data });
      return;
    }
    const account = await db.account.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!account) throw new Error('DbTokenStore: no account to attach eBay credentials to');
    await db.ebayCredential.create({ data: { accountId: account.id, ordersSyncedAt: this.now(), ...data } });
  }
}
