import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { PricingRule, SupplierQuote } from '@/api/types';
import { formatCents, formatPct, marginState } from '@/lib/money';
import { cn } from '@/lib/cn';

interface Props {
  /** Latest answer from /supplier-quote, if any. */
  quote?: SupplierQuote;
  /** The numbers typed have moved on since `quote` was computed. */
  stale: boolean;
  error?: string;
  /** Cost + shipping as typed, in cents. */
  totalCents: number | null;
  rule: Pick<PricingRule, 'floorPct' | 'targetPct'>;
}

type Verdict = 'idle' | 'loss' | 'below' | 'thin' | 'good';

const box: Record<Verdict, string> = {
  idle: 'border-rule bg-sunken',
  loss: 'border-floor/60 bg-floor/10',
  below: 'border-floor/50 bg-floor/8',
  thin: 'border-amber/50 bg-amber/10',
  good: 'border-green/40 bg-green/10',
};
const ink: Record<Verdict, string> = { idle: 'text-ink', loss: 'text-floor', below: 'text-floor', thin: 'text-amber', good: 'text-green' };

/**
 * The seller's last look before paying. It leads with the net profit in the display face and says in words, not only colour,
 * whether the order clears the floor. Everything shown comes from the quote endpoint in integer cents.
 */
export function MarginReadout({ quote, stale, error, totalCents, rule }: Props) {
  const verdict: Verdict = !quote ? 'idle' : quote.netProfitCents < 0 ? 'loss' : !quote.meetsFloor ? 'below' : marginState(quote.netMarginPct, rule) === 'good' ? 'good' : 'thin';
  // Two decimals on the margin so 14.96% never reads as the 15% floor it is below.
  const floor = formatPct(rule.floorPct, Number.isInteger(Number((rule.floorPct * 100).toFixed(4))) ? 0 : 2);
  const over = quote && totalCents !== null ? totalCents - quote.maxSupplierCostCents : 0;
  const Icon = verdict === 'good' || verdict === 'thin' ? CheckCircle2 : verdict === 'idle' ? Info : AlertTriangle;

  const headline = {
    idle: 'Type what your supplier quoted',
    loss: 'You would lose money on this order',
    below: `Below your ${floor} floor`,
    thin: `Clears your ${floor} floor, under your target`,
    good: `Clears your ${floor} floor and your target`,
  }[verdict];

  return (
    <div role="status" aria-live="polite" aria-busy={stale} className={cn('rounded-lg border px-4 py-3 transition-opacity', box[verdict], stale && quote && 'opacity-60')}>
      <div className={cn('flex items-center gap-2 text-[14px] font-medium', ink[verdict])}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{headline}</span>
        {stale && quote && <span className="ml-auto text-[12px] font-normal text-muted">Updating…</span>}
      </div>

      {!quote && !error && (
        <p className="text-[13px] text-muted mt-1.5">Enter the item cost and the shipping, in dollars. Your margin shows here before you pay anything.</p>
      )}
      {error && <p className="text-[13px] text-muted mt-1.5">Could not check the margin ({error}). You can still record the order; Floor checks it again when you do.</p>}

      {quote && (
        <>
          <div className="flex items-end justify-between gap-4 mt-2">
            <div>
              <div className="text-[12.5px] text-muted">Net profit if you pay this</div>
              <div className={cn('num font-display text-[34px] leading-none mt-1', ink[verdict])}>{formatCents(quote.netProfitCents, { signed: true })}</div>
            </div>
            <div className="text-right">
              <div className={cn('num font-display text-[22px] leading-none', ink[verdict])}>{formatPct(quote.netMarginPct, 2)}</div>
              <div className="text-[12.5px] text-muted mt-1">margin (floor {floor})</div>
            </div>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-[13px] mt-3 pt-2 border-t border-current/10">
            <dt className="text-muted">You pay in total</dt><dd className="num text-right">{formatCents(totalCents)}</dd>
            <dt className="text-muted">Pay at most</dt><dd className="num text-right">{formatCents(quote.maxSupplierCostCents)}</dd>
            <dt className="text-muted">eBay fees</dt><dd className="num text-right">{formatCents(quote.ebayFeesCents)}</dd>
          </dl>
          {over > 0 && <p className={cn('text-[13px] mt-2 font-medium', ink[verdict])}>That is {formatCents(over)} over the most Floor allows.</p>}
        </>
      )}
    </div>
  );
}
