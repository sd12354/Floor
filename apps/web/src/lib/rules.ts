import type { Account, AccountPatch, FeeConfig, PricingRule } from '@/api/types';
import { accountFees, effectiveVariablePct, MAX_AD_RATE_PCT, MIN_AD_RATE_PCT } from '@/lib/money';

export interface RulesDraft {
  pricingRule: PricingRule;
  fees: FeeConfig;
  dailySpendCapCents: number;
  smallLossToleranceCents: number;
  handlingTimeDays: number;
  promotedAdsEnabled: boolean;
  promotedAdRatePct: number;
}

export const toPatch = (d: RulesDraft): AccountPatch => ({ ...d });

export const rulesFromAccount = (a: Account): RulesDraft => ({
  pricingRule: a.pricingRule, fees: a.fees, dailySpendCapCents: a.dailySpendCapCents, smallLossToleranceCents: a.smallLossToleranceCents, handlingTimeDays: a.handlingTimeDays,
  promotedAdsEnabled: a.promotedAdsEnabled ?? false, promotedAdRatePct: a.promotedAdRatePct ?? 0.02,
});

/** The fee table the draft would price with (previews use this so the example matches what the API will do). */
export const draftFees = (d: RulesDraft): FeeConfig => accountFees(d);

/** Why the ad-rate settings cannot be saved, or null. Mirrors the API's checks (range, and room left for the target margin). */
export function adRateError(d: RulesDraft): string | null {
  if (!d.promotedAdsEnabled) return null;
  if (d.promotedAdRatePct < MIN_AD_RATE_PCT - 1e-9) return `eBay's lowest ad rate is ${MIN_AD_RATE_PCT * 100}%.`;
  if (d.promotedAdRatePct > MAX_AD_RATE_PCT + 1e-9) return 'The ad rate cannot be above 100%.';
  if (1 - effectiveVariablePct(draftFees(d)) - d.pricingRule.targetPct <= 0) return 'Too high: eBay fees plus this rate leave no room for your target margin.';
  return null;
}
