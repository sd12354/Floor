import type { FeeConfig, PricingRule } from '@/api/types';
import type { RulesDraft } from '@/lib/rules';
import { MoneyField, PctField, SelectField, TextField, Toggle } from '@/components/ui';
import { PriceExample } from '@/components/PriceExample';


interface Props {
  draft: RulesDraft;
  onChange: (next: RulesDraft) => void;
  /** Onboarding shows only the essentials; Settings shows fees too. */
  compact?: boolean;
}

export function RulesForm({ draft, onChange, compact }: Props) {
  const set = <K extends keyof RulesDraft>(k: K, v: RulesDraft[K]) => onChange({ ...draft, [k]: v });
  const setRule = <K extends keyof PricingRule>(k: K, v: PricingRule[K]) => set('pricingRule', { ...draft.pricingRule, [k]: v });
  const setFee = <K extends keyof FeeConfig>(k: K, v: FeeConfig[K]) => set('fees', { ...draft.fees, [k]: v });
  const floorAboveTarget = draft.pricingRule.floorPct > draft.pricingRule.targetPct;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <PctField label="Margin floor" value={draft.pricingRule.floorPct} onChange={(v) => setRule('floorPct', v)} error={floorAboveTarget ? 'The floor must be at or below the target.' : undefined} hint="Floor never fulfils or lists below this net margin." />
        <PctField label="Target margin" value={draft.pricingRule.targetPct} onChange={(v) => setRule('targetPct', v)} hint="New listings are priced to net this." />
        <SelectField label="Round prices to" value={draft.pricingRule.roundTo} onChange={(e) => setRule('roundTo', e.target.value as PricingRule['roundTo'])}>
          <option value="0.99">.99 endings</option>
          <option value="0.95">.95 endings</option>
          <option value="none">No rounding</option>
        </SelectField>
        <TextField label="Handling time (days)" type="number" inputMode="numeric" min={1} max={30} value={draft.handlingTimeDays} onChange={(e) => set('handlingTimeDays', Math.max(1, parseInt(e.target.value || '1', 10)))} hint="What eBay promises buyers. Held orders are cancelled 12h before this runs out." />
        <MoneyField label="Daily supplier spend cap" valueCents={draft.dailySpendCapCents} onChangeCents={(c) => set('dailySpendCapCents', c)} hint="Orders beyond this queue until midnight. Caps the float you can build in one day." />
        <MoneyField label="Small-loss tolerance" valueCents={draft.smallLossToleranceCents} onChangeCents={(c) => set('smallLossToleranceCents', c)} hint="Fulfil anyway if the loss is at most this, to protect your seller rating." />
      </div>

      <PriceExample fees={draft.fees} rule={draft.pricingRule} />

      {!compact && (
        <fieldset className="flex flex-col gap-4">
          <legend className="text-[15px] font-display mb-1">eBay fees</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <PctField label="Final value fee" value={draft.fees.finalValueFeePct} onChange={(v) => setFee('finalValueFeePct', v)} hint="13.6% for most US categories in 2026." />
            <MoneyField label="Per-order fee" valueCents={draft.fees.perOrderFeeCents} onChangeCents={(c) => setFee('perOrderFeeCents', c)} hint="$0.40, or $0.30 on orders of $10 or less." />
            <PctField label="Promoted listings rate" value={draft.fees.promotedPct} onChange={(v) => setFee('promotedPct', v)} hint="0 unless you run promoted listings." />
          </div>
          <div className="flex flex-col gap-1">
            <Toggle label="eBay Store subscription" hint="Takes 0.9% off the final value fee." checked={draft.fees.storeDiscountPct > 0} onChange={(v) => setFee('storeDiscountPct', v ? 0.009 : 0)} />
            <Toggle label="Top Rated Seller" hint="10% off the variable part of the fee." checked={draft.fees.topRatedDiscountPct > 0} onChange={(v) => setFee('topRatedDiscountPct', v ? 0.1 : 0)} />
            <Toggle label="Below Standard status" hint="Adds a 6% surcharge. Floor's goal is to keep you out of this." checked={draft.fees.belowStandardSurchargePct > 0} onChange={(v) => setFee('belowStandardSurchargePct', v ? 0.06 : 0)} />
          </div>
        </fieldset>
      )}
    </div>
  );
}
