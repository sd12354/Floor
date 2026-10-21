import type { FeeConfig, PricingRule } from '@/api/types';
import { computeMargin, formatCents, formatPct, marginColorClass, marginLabel, marginState, priceForTarget } from '@/lib/money';
import { cn } from '@/lib/cn';

interface Props {
  fees: FeeConfig;
  rule: PricingRule;
  /** Example supplier cost, default $12.00 */
  costCents?: number;
  shippingCents?: number;
}

/** "A $40 item with $12 cost prices at $__ and nets __%" — the sentence the seller tunes settings against. */
export function PriceExample({ fees, rule, costCents = 1200, shippingCents = 0 }: Props) {
  const price = priceForTarget(costCents, shippingCents, fees, rule);
  const m = computeMargin({ salePriceCents: price, buyerShippingCents: 0, supplierCostCents: costCents, supplierShippingCents: shippingCents, toolFeeCents: 0, fees });
  const fortyAtCost = computeMargin({ salePriceCents: 4000, buyerShippingCents: 0, supplierCostCents: costCents, supplierShippingCents: shippingCents, toolFeeCents: 0, fees });
  const state = marginState(m.netMarginPct, rule);
  const floorPrice = priceForTarget(costCents, shippingCents, fees, { ...rule, targetPct: rule.floorPct });

  return (
    <div className="rounded-lg bg-sunken/70 border border-rule px-4 py-3.5 text-[14px] leading-relaxed">
      <p>
        An item that costs <strong className="num">{formatCents(costCents)}</strong> from the supplier lists at{' '}
        <strong className="num">{formatCents(price)}</strong> and nets{' '}
        <strong className={cn('num', marginColorClass[state])}>{formatCents(m.netProfitCents)}</strong>{' '}
        <span className={cn('num', marginColorClass[state])}>({formatPct(m.netMarginPct)}, {marginLabel[state].toLowerCase()})</span>{' '}
        after <span className="num">{formatCents(m.ebayFeesCents)}</span> in eBay fees.
      </p>
      <p className="text-muted mt-1.5 text-[13px]">
        Sold at a flat $40.00 it would net <span className="num">{formatCents(fortyAtCost.netProfitCents)}</span> ({formatPct(fortyAtCost.netMarginPct)}).
        Floor pauses the listing if the supplier price rises so far that it could not sell above <span className="num">{formatCents(floorPrice)}</span>.
      </p>
    </div>
  );
}
