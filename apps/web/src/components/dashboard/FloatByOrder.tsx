import { Link } from 'react-router-dom';
import type { FloatRow } from '@/api/types';
import { Card, EmptyState } from '@/components/ui';
import { formatCents, formatDate } from '@/lib/money';
import { orderStatusLabel } from '@/lib/labels';

type Row = Pick<FloatRow, 'orderId' | 'amountCents' | 'payoutExpectedAt'> & Partial<Pick<FloatRow, 'listingTitle' | 'status'>>;

/**
 * Float, broken down by order and sorted by when eBay should pay out. Orders not yet delivered have no
 * payout date and sort last. Bars are relative to the largest.
 */
export function FloatByOrder({ rows }: { rows?: Row[] }) {
  if (!rows) return <Card title="Float by payout date"><div className="h-40 skeleton rounded" /></Card>;
  const sorted = [...rows].sort((a, b) => (a.payoutExpectedAt ?? '9').localeCompare(b.payoutExpectedAt ?? '9'));
  const max = Math.max(1, ...rows.map((r) => r.amountCents));
  return (
    <Card title="Float by payout date" padded={false}>
      {sorted.length === 0 ? (
        <EmptyState compact title="No money out" description="Float is what you have paid suppliers that eBay has not paid you back yet." />
      ) : (
        <ol className="px-4 pb-3 pt-1 flex flex-col gap-2">
          {sorted.map((r) => (
            <li key={r.orderId}>
              <Link to={`/orders/${r.orderId}`} className="block group">
                <div className="flex justify-between text-[12.5px] mb-0.5">
                  <span className="text-muted group-hover:text-ink truncate">
                    {r.payoutExpectedAt ? formatDate(r.payoutExpectedAt, { weekday: 'short', month: 'short', day: 'numeric' }) : `${r.status ? orderStatusLabel[r.status] : 'In transit'}, payout after delivery`}
                    {r.listingTitle && <span className="text-faint"> · {r.listingTitle}</span>}
                  </span>
                  <span className="num">{formatCents(r.amountCents)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-sunken overflow-hidden">
                  <div className="h-full bg-accent/70 rounded-full" style={{ width: `${(r.amountCents / max) * 100}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
