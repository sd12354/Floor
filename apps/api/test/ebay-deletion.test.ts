import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealTestApp, type RealTestApp } from './realHelpers.js';

let t: RealTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const TOKEN = 'floor-deletion-verification-token-abc123';
const ENDPOINT = 'https://floor.example.com/api/v1/webhooks/ebay/account-deletion';

describe('eBay marketplace account-deletion endpoint', () => {
  it('answers the GET challenge with sha256(challengeCode + token + endpoint) as hex', async () => {
    t = await createRealTestApp({ config: { ebayDeletionToken: TOKEN, ebayDeletionEndpoint: ENDPOINT } });
    const challenge = 'abc-challenge-123';
    const r = await t.api<{ challengeResponse: string }>(
      'GET',
      `/webhooks/ebay/account-deletion?challenge_code=${challenge}`,
    );
    expect(r.status).toBe(200);
    const expected = createHash('sha256').update(challenge).update(TOKEN).update(ENDPOINT).digest('hex');
    expect(r.body.challengeResponse).toBe(expected);
  });

  it('rejects a GET with no challenge_code', async () => {
    t = await createRealTestApp({ config: { ebayDeletionToken: TOKEN, ebayDeletionEndpoint: ENDPOINT } });
    const r = await t.api('GET', '/webhooks/ebay/account-deletion');
    expect(r.status).toBe(400);
  });

  it('returns 503 when the token/endpoint are not configured', async () => {
    t = await createRealTestApp({ config: { ebayDeletionToken: undefined, ebayDeletionEndpoint: undefined } });
    const r = await t.api('GET', '/webhooks/ebay/account-deletion?challenge_code=x');
    expect(r.status).toBe(503);
  });

  it('acknowledges the POST notification with 200', async () => {
    t = await createRealTestApp({ config: { ebayDeletionToken: TOKEN, ebayDeletionEndpoint: ENDPOINT } });
    const r = await t.api('POST', '/webhooks/ebay/account-deletion', {
      metadata: { topic: 'MARKETPLACE_ACCOUNT_DELETION', schemaVersion: '1.0', deprecated: false },
      notification: { notificationId: 'n-1', eventDate: '2026-11-07T20:00:00.000Z', data: { username: 'buyer', userId: 'u-1', eiasToken: 'e' } },
    });
    expect(r.status).toBe(200);
  });

  it('does not require authentication (eBay calls it unauthenticated)', async () => {
    t = await createRealTestApp({ config: { ebayDeletionToken: TOKEN, ebayDeletionEndpoint: ENDPOINT } });
    // No Authorization header, no webhook secret.
    const r = await t.api('GET', `/webhooks/ebay/account-deletion?challenge_code=ping`);
    expect(r.status).toBe(200);
  });
});
