import type { PricingRule } from '@/api/types';
import { formatPct, marginColorClass, marginLabel, marginState } from '@/lib/money';
import { cn } from '@/lib/cn';

interface Props {
  pct: number;
  rule: Pick<PricingRule, 'floorPct' | 'targetPct'>;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

/** Margin with colour *and* a text label, so the state never relies on colour alone. */
export function MarginCell({ pct, rule, showLabel = true, size = 'sm' }: Props) {
  const state = marginState(pct, rule);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={cn('num font-medium', marginColorClass[state], size === 'md' ? 'text-[16px]' : 'text-[13.5px]')}>
        {formatPct(pct)}
      </span>
      {showLabel && <span className="text-[11px] text-muted">{marginLabel[state]}</span>}
    </span>
  );
}
