import { EbayApiError, EbayReauthRequiredError, RealEbay, type CategorySuggestion, type EbaySetupInput } from '@floor/core';
import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import { AppError } from '../errors.js';
import { writeEvent } from './audit.js';

export interface SetupResponse {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  merchantLocationKey: string;
  categorySuggestions: CategorySuggestion[];
  /** Ready to paste into apps/api/.env. Returned only; Floor never writes it anywhere. */
  envLines: string;
  reused: { fulfillmentPolicy: boolean; paymentPolicy: boolean; returnPolicy: boolean; location: boolean };
  notes: string[];
}

/** The .env block for the four ids plus the first suggested category (or a commented placeholder). */
export function buildEnvLines(r: Pick<SetupResponse, 'fulfillmentPolicyId' | 'paymentPolicyId' | 'returnPolicyId' | 'merchantLocationKey' | 'categorySuggestions'>): string {
  const first = r.categorySuggestions[0];
  return [
    `EBAY_FULFILLMENT_POLICY_ID=${r.fulfillmentPolicyId}`,
    `EBAY_PAYMENT_POLICY_ID=${r.paymentPolicyId}`,
    `EBAY_RETURN_POLICY_ID=${r.returnPolicyId}`,
    `EBAY_MERCHANT_LOCATION_KEY=${r.merchantLocationKey}`,
    first ? `EBAY_DEFAULT_CATEGORY_ID=${first.categoryId}` : '# EBAY_DEFAULT_CATEGORY_ID=<pick a category id>',
  ].join('\n');
}

/** Mock mode: deterministic fake ids so the UI works with no credentials. Nothing is created anywhere. */
export function mockSetup(input: EbaySetupInput): SetupResponse {
  const q = input.categoryQuery?.trim();
  const categorySuggestions: CategorySuggestion[] = q
    ? [
        { categoryId: '11700', name: `Home & Garden > ${q} (demo)` },
        { categoryId: '26395', name: 'Health & Beauty > Other (demo)' },
        { categoryId: '159912', name: 'Everything Else > Other (demo)' },
      ]
    : [];
  const base = { fulfillmentPolicyId: '6000000001', paymentPolicyId: '6000000002', returnPolicyId: '6000000003', merchantLocationKey: 'floor-default', categorySuggestions };
  return { ...base, envLines: buildEnvLines(base), reused: { fulfillmentPolicy: false, paymentPolicy: false, returnPolicy: false, location: false }, notes: ['Demo values: mock mode does not talk to eBay. Nothing was created.'] };
}

/** Real mode: needs a connected eBay. eBay failures become contract errors with a message the seller can act on. */
export async function runSetup(db: Db, connectors: Connectors, accountId: string, input: EbaySetupInput): Promise<SetupResponse> {
  const ebay = connectors.ebay;
  if (!(ebay instanceof RealEbay) || !(await ebay.hasCredentials())) {
    throw new AppError(409, 'EBAY_NOT_CONNECTED', 'Connect your eBay account first (Settings > Connect eBay), then run setup.');
  }
  try {
    const r = await ebay.setupListingBasics(input);
    const out: SetupResponse = { ...r, envLines: buildEnvLines(r) };
    await writeEvent(db, { accountId, type: 'ebay.setup', payload: { ...r.reused, merchantLocationKey: r.merchantLocationKey } });
    return out;
  } catch (err) {
    if (err instanceof EbayReauthRequiredError) throw new AppError(409, 'EBAY_REAUTH_REQUIRED', err.message);
    if (err instanceof EbayApiError) throw new AppError(502, 'EBAY_API_ERROR', err.message);
    throw err;
  }
}
