import { bidPercentageString, normalizeAdRate } from '../../promoted.js';
import type { Pct } from '../../types.js';
import type { EbayAdResult } from '../types.js';
import type { EbayHttp } from './ebayHttp.js';
import { EbayApiError, EbayReauthRequiredError } from './ebayTypes.js';

/** One campaign holds every Floor ad; found by this name so a retry or a second server reuses it. */
export const AD_CAMPAIGN_NAME = 'Floor - promoted listings';
const MKT = '/sell/marketing/v1';

interface CampaignRow {
  campaignId?: string;
  campaignName?: string;
  campaignStatus?: string;
}
interface AdRow {
  adId?: string;
  listingId?: string;
  bidPercentage?: string;
  adStatus?: string;
}

/** eBay answers a missing scope with 403 (or 401 after a refresh); tell the seller to reconnect instead of showing a raw API error. */
function scopeHint(err: unknown): never {
  if (err instanceof EbayApiError && (err.status === 403 || err.status === 401)) {
    throw new EbayReauthRequiredError('eBay denied the promoted-ads request (' + err.status + '): the connected token is missing the marketing permission, or the account cannot use Promoted Listings yet. Reconnect eBay from Settings and approve every permission, then try again.');
  }
  throw err;
}

const idFromLocation = (loc: string | null): string | null => (loc ? (loc.split('?')[0]?.split('/').filter(Boolean).pop() ?? null) : null);

/**
 * Promoted Listings Standard (cost per sale) through the Marketing API: one find-or-create campaign, one ad per
 * listing id carrying the ad rate (`bidPercentage`). eBay charges that percentage of the sale on each sale that comes
 * through the ad and nothing otherwise. Every method is idempotent.
 */
export class EbayAds {
  private campaignId: string | null = null;

  constructor(private readonly http: EbayHttp, private readonly marketplaceId: string, private readonly now: () => Date, private readonly log?: (m: string, meta?: Record<string, unknown>) => void) {}

  private async findCampaign(): Promise<CampaignRow | null> {
    const r = await this.http.request<{ campaigns?: CampaignRow[] }>({ method: 'GET', path: `${MKT}/ad_campaign`, query: { campaign_name: AD_CAMPAIGN_NAME }, allow: [204, 404] });
    const rows = (r.json?.campaigns ?? []).filter((c) => c.campaignName === AD_CAMPAIGN_NAME && c.campaignId);
    return rows.find((c) => c.campaignStatus !== 'ENDED') ?? null;
  }

  /** Find-or-create the Floor campaign (resuming it when paused). Returns its id. */
  async ensureCampaign(): Promise<string> {
    if (this.campaignId) return this.campaignId;
    try {
      let row = await this.findCampaign();
      if (!row) {
        try {
          const created = await this.http.request({
            method: 'POST',
            path: `${MKT}/ad_campaign`,
            body: { campaignName: AD_CAMPAIGN_NAME, marketplaceId: this.marketplaceId, startDate: this.now().toISOString(), fundingStrategy: { fundingModel: 'COST_PER_SALE' } },
          });
          const id = idFromLocation(created.headers.get('location'));
          if (id) {
            this.campaignId = id;
            return id;
          }
          row = await this.findCampaign();
        } catch (err) {
          // duplicate name, or a race with another run: look it up again and reuse it
          if (!(err instanceof EbayApiError && (err.status === 400 || err.status === 409))) throw err;
          row = await this.findCampaign();
          if (!row) throw err;
        }
      }
      if (!row?.campaignId) throw new EbayApiError(502, 'eBay created the promoted-ads campaign but it could not be found again');
      if (row.campaignStatus === 'PAUSED') await this.http.request({ method: 'POST', path: `${MKT}/ad_campaign/${row.campaignId}/resume` });
      this.campaignId = row.campaignId;
      return row.campaignId;
    } catch (err) {
      return scopeHint(err);
    }
  }

  private async adFor(campaignId: string, listingId: string): Promise<AdRow | null> {
    const r = await this.http.request<{ ads?: AdRow[] }>({ method: 'GET', path: `${MKT}/ad_campaign/${campaignId}/ad`, query: { listing_ids: listingId }, allow: [204, 404] });
    return (r.json?.ads ?? []).find((a) => a.listingId === listingId && a.adId && a.adStatus !== 'ARCHIVED') ?? null;
  }

  /** Ensure the listing has an ad at exactly this rate: create it, change its rate, or do nothing when it already matches. */
  async promote(listingId: string, rate: Pct): Promise<EbayAdResult> {
    const ratePct = normalizeAdRate(rate);
    const bid = bidPercentageString(ratePct);
    const campaignId = await this.ensureCampaign();
    try {
      const have = await this.adFor(campaignId, listingId);
      if (have?.adId) {
        if (Number(have.bidPercentage) !== Number(bid)) {
          await this.http.request({ method: 'POST', path: `${MKT}/ad_campaign/${campaignId}/ad/${have.adId}/update_bid`, body: { bidPercentage: bid } });
        }
        return { campaignId, adId: have.adId, ratePct };
      }
      let adId: string | null = null;
      try {
        const created = await this.http.request({ method: 'POST', path: `${MKT}/ad_campaign/${campaignId}/ad`, body: { listingId, bidPercentage: bid } });
        adId = idFromLocation(created.headers.get('location'));
      } catch (err) {
        // the ad may exist already (a retry after a lost response): re-check before giving up
        if (!(err instanceof EbayApiError && (err.status === 400 || err.status === 409))) throw err;
        const again = await this.adFor(campaignId, listingId);
        if (!again?.adId) throw err;
        adId = again.adId;
      }
      adId ??= (await this.adFor(campaignId, listingId))?.adId ?? null;
      if (!adId) throw new EbayApiError(502, `eBay created the ad for listing ${listingId} but returned no ad id`);
      return { campaignId, adId, ratePct };
    } catch (err) {
      return scopeHint(err);
    }
  }

  /** Delete the listing's ad if it has one. Returns whether an ad was removed. Never creates the campaign. */
  async remove(listingId: string): Promise<boolean> {
    try {
      const campaign = this.campaignId ? { campaignId: this.campaignId } : await this.findCampaign();
      if (!campaign?.campaignId) return false;
      const ad = await this.adFor(campaign.campaignId, listingId);
      if (!ad?.adId) return false;
      await this.http.request({ method: 'DELETE', path: `${MKT}/ad_campaign/${campaign.campaignId}/ad/${ad.adId}`, allow: [404] });
      this.log?.('Removed promoted ad', { listingId });
      return true;
    } catch (err) {
      return scopeHint(err);
    }
  }
}
