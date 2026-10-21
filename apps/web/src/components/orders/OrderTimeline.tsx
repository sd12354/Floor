import type { OrderDetail } from '@/api/types';
import { formatCents, formatDateTime, formatPct } from '@/lib/money';
import { eventTypeLabel } from '@/lib/labels';
import { cn } from '@/lib/cn';

const stages = ['paid', 'checking', 'ordered', 'shipped', 'delivered', 'payout'] as const;
const stageLabel: Record<(typeof stages)[number], string> = {
  paid: 'Buyer paid', checking: 'Margin re-checked', ordered: 'Ordered from supplier', shipped: 'Shipped, tracking on eBay', delivered: 'Delivered', payout: 'eBay payout',
};

function detailFor(e: OrderDetail['events'][number]): string | null {
  const p = e.payload;
  switch (e.type) {
    case 'order.checking': {
      const parts: string[] = [];
      if (typeof p.supplierCostCents === 'number') parts.push(`supplier cost ${formatCents(p.supplierCostCents)}${typeof p.previousCostCents === 'number' && p.previousCostCents !== p.supplierCostCents ? ` (was ${formatCents(p.previousCostCents)})` : ''}`);
      if (typeof p.netMarginPct === 'number') parts.push(`margin ${formatPct(p.netMarginPct)}`);
      return parts.join(', ') || null;
    }
    case 'order.ordered': return typeof p.supplierOrderId === 'string' ? `Supplier ref ${p.supplierOrderId}` : null;
    case 'order.shipped': return [p.carrier, p.trackingNumber].filter(Boolean).join(' ') || null;
    case 'order.queued': return typeof p.spentTodayCents === 'number' ? `${formatCents(p.spentTodayCents)} of ${formatCents(Number(p.capCents))} cap already spent today` : null;
    case 'order.held': return typeof p.deadline === 'string' ? `Deadline ${formatDateTime(p.deadline)}` : null;
    case 'order.payout': return typeof p.amountCents === 'number' ? formatCents(p.amountCents) : null;
    case 'order.decision': return typeof p.action === 'string' ? `You chose to ${p.action}` : null;
    default: return null;
  }
}

/**
 * Vertical timeline. Actual events are drawn from `events[]`; the stages that have not happened yet
 * are drawn hollow so the seller can see how far along the order is.
 */
export function OrderTimeline({ order }: { order: OrderDetail }) {
  const events = [...order.events].sort((a, b) => a.at.localeCompare(b.at));
  const doneTypes = new Set(events.map((e) => e.type.replace('order.', '')));
  const terminal = order.status === 'cancelled' || order.status === 'refunded';
  const remaining = terminal ? [] : stages.filter((s) => !doneTypes.has(s) && !(s === 'payout' && doneTypes.has('payout')));

  return (
    <ol className="relative ml-2 border-l border-rule">
      {events.map((e) => {
        const bad = e.type === 'order.held' || e.type === 'order.cancelled';
        const warn = e.type === 'order.queued';
        const detail = detailFor(e);
        return (
          <li key={e.id} className="relative pl-5 pb-4 last:pb-0">
            <span className={cn('absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full ring-2 ring-surface', bad ? 'bg-floor' : warn ? 'bg-amber' : 'bg-accent')} aria-hidden />
            <div className="text-[13.5px] leading-snug">{eventTypeLabel(e.type)}</div>
            {detail && <div className="text-[12.5px] text-muted">{detail}</div>}
            <time className="block text-[12px] text-faint mt-0.5" dateTime={e.at}>{formatDateTime(e.at)}</time>
          </li>
        );
      })}
      {remaining.map((s) => (
        <li key={s} className="relative pl-5 pb-4 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full border border-faint bg-surface" aria-hidden />
          <div className="text-[13.5px] text-faint">{stageLabel[s]}</div>
        </li>
      ))}
      {events.length === 0 && remaining.length === 0 && <li className="pl-5 text-[13.5px] text-muted">No events recorded.</li>}
    </ol>
  );
}
