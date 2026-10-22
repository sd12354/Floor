import { createHash, randomBytes } from 'node:crypto';
import { RealEbay } from '@floor/core';
import type { AppConfig } from '../config.js';
import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import { AppError } from '../errors.js';
import { writeEvent } from './audit.js';
import { parseSecretKey } from './secretBox.js';

export const OAUTH_STATE_TTL_MS = 10 * 60_000;

const hashState = (state: string): string => createHash('sha256').update(state).digest('hex');

function realEbay(connectors: Connectors): RealEbay {
  if (!(connectors.ebay instanceof RealEbay)) throw new AppError(422, 'REAL_ONLY', 'eBay OAuth is only available in real mode');
  return connectors.ebay;
}

/**
 * Start the connect flow: refuses (501 NOT_CONFIGURED) without a usable FLOOR_SECRET_KEY, since tokens could not be
 * stored; otherwise mints a random single-use state bound to this account and returns eBay's consent URL.
 */
export async function beginEbayConnect(db: Db, connectors: Connectors, config: AppConfig, accountId: string, now = new Date()): Promise<{ authorizeUrl: string }> {
  parseSecretKey(config.secretKey);
  const ebay = realEbay(connectors);
  const state = randomBytes(32).toString('base64url');
  const authorizeUrl = ebay.authorizeUrl(state); // throws NotConfiguredError before we store anything
  await db.ebayOAuthState.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.ebayOAuthState.create({ data: { id: hashState(state), accountId, expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS) } });
  return { authorizeUrl };
}

/** Atomically consume a state: valid once, within its TTL. Returns the account it was issued to, else throws 400. */
export async function consumeState(db: Db, state: string | undefined, now = new Date()): Promise<string> {
  const invalid = new AppError(400, 'INVALID_STATE', 'The eBay connection link is invalid, expired or already used. Start again from Settings.');
  if (!state || state.length > 200) throw invalid;
  const id = hashState(state);
  const claimed = await db.ebayOAuthState.updateMany({ where: { id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (claimed.count !== 1) throw invalid;
  const row = await db.ebayOAuthState.findUniqueOrThrow({ where: { id } });
  return row.accountId;
}

/** Exchange the code, store the tokens (encrypted), mark the account connected with the eBay username. */
export async function completeEbayConnect(db: Db, connectors: Connectors, config: AppConfig, accountId: string, code: string): Promise<{ username: string }> {
  parseSecretKey(config.secretKey);
  const ebay = realEbay(connectors);
  await ebay.exchangeCode(code); // persists via DbTokenStore (encrypted)
  let username = 'ebay_seller';
  try {
    username = (await ebay.getUsername()) ?? username;
  } catch {
    // The Identity call is cosmetic; a failure must not undo a successful connection.
  }
  await db.account.update({ where: { id: accountId }, data: { ebayConnected: true, ebayUsername: username } });
  await writeEvent(db, { accountId, type: 'ebay.connected', payload: { username } });
  return { username };
}
