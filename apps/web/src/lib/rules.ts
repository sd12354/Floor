import type { Account, AccountPatch, FeeConfig, PricingRule } from '@/api/types';

export interface RulesDraft {
  pricingRule: PricingRule;
  fees: FeeConfig;
  dailySpendCapCents: number;
  smallLossToleranceCents: number;
  handlingTimeDays: number;
}

export const toPatch = (d: RulesDraft): AccountPatch => ({ ...d });

export const rulesFromAccount = (a: Account): RulesDraft => ({
  pricingRule: a.pricingRule, fees: a.fees, dailySpendCapCents: a.dailySpendCapCents, smallLossToleranceCents: a.smallLossToleranceCents, handlingTimeDays: a.handlingTimeDays,
});
