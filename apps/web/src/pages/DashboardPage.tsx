import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAccount, useDashboard, useListings, useOrders } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Card, Stat, StatSkeleton, ErrorState, Badge, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatCents, formatDate, formatPct, relativeTime } from '@/lib/money';
import { eventTypeLabel, pauseReasonLabel } from '@/lib/labels';
import { cn } from '@/lib/cn';
import { FloatByOrder } from '@/components/dashboard/FloatByOrder';
import { HealthPanel } from '@/components/dashboard/HealthPanel';

export function DashboardPage() {
  const { data, isPending, error, refetch } = useDashboard();
  const { data: account } = useAccount();
  const held = useOrders({ status: 'held' });
  const queued = useOrders({ status: 'queued' });
  const blocked = useListings({ status: 'blocked' });
  const paused = useListings({ status: 'paused' });

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;

  const nextPayout = data?.float.byOrder
    .map((o) => o.payoutExpectedAt)
    .filter((d): d is string => typeof d === 'string')
    .sort()[0];
  const spendPct = data ? Math.min(1, data.today.supplierSpendCents / Math.max(1, data.today.spendCapCents)) : 0;
  const todayTone = !data ? 'default' : data.today.profitCents > 0 ? 'good' : data.today.profitCents < 0 ? 'below' : 'default';

  const attention = [
    ...(held.data?.items ?? []).map((o) => ({ key: o.id, to: `/orders/${o.id}`, label: `Held: ${o.listing.title}`, detail: `Fulfilling nets ${formatCents(o.netProfitCents)}. Decide by ${formatDate(o.holdDeadline, { month: 'short', day: 'numeric', hour: 'numeric' })}.`, tone: 'below' as const })),
    ...(queued.data?.items ?? []).map((o) => ({ key: o.id, to: `/orders/${o.id}`, label: `Queued: ${o.listing.title}`, detail: 'Daily spend cap reached. Orders after midnight, or raise the cap in Settings.', tone: 'thin' as const })),
    ...(blocked.data?.items ?? []).map((l) => ({ key: l.id, to: '/listings?status=blocked', label: `Blocked: ${l.title}`, detail: pauseReasonLabel(l.pauseReason, l) ?? 'Compliance check failed', tone: 'below' as const })),
    ...(paused.data?.items ?? []).map((l) => ({ key: l.id, to: '/listings?status=paused', label: `Paused: ${l.title}`, detail: pauseReasonLabel(l.pauseReason, l) ?? 'Paused', tone: 'thin' as const })),
  ];

  return (
    <>
      <PageHeader title={account ? `${account.name}` : 'Dashboard'} description={account?.ebayUsername ? `Selling as ${account.ebayUsername} on eBay. Floor ${formatPct(account.pricingRule.floorPct, 0)}, target ${formatPct(account.pricingRule.targetPct, 0)}.` : undefined} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {isPending || !data ? (
          <>
            <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
          </>
        ) : (
          <>
            <Stat
              label="Float outstanding"
              emphasis
              value={formatCents(data.float.outstandingCents)}
              hint={nextPayout ? <>Paid to suppliers, awaiting eBay. Next payout {formatDate(nextPayout)}.</> : 'Nothing owed to you right now.'}
              className="col-span-2 lg:col-span-1"
            />
            <Stat label="Today's profit" value={formatCents(data.today.profitCents)} tone={todayTone} hint={<>on {formatCents(data.today.revenueCents)} revenue</>} />
            <Stat label="Today's orders" value={data.today.orders} hint={data.today.orders === 0 ? 'None yet today' : 'paid by buyers'} />
            <Stat label="Supplier spend today" value={formatCents(data.today.supplierSpendCents, { whole: true })} hint={<>of {formatCents(data.today.spendCapCents, { whole: true })} daily cap</>} className="col-span-2 lg:col-span-1">
              <div className="h-1.5 w-full rounded-full bg-sunken mt-1 overflow-hidden" role="progressbar" aria-valuenow={Math.round(spendPct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Daily cap used">
                <div className={cn('h-full rounded-full', spendPct >= 0.95 ? 'bg-floor' : spendPct >= 0.75 ? 'bg-amber' : 'bg-accent')} style={{ width: `${spendPct * 100}%` }} />
              </div>
            </Stat>
          </>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-3 mt-3">
        <Card title="Needs attention" className="lg:col-span-2" padded={false}>
          {attention.length === 0 ? (
            <EmptyState compact title="Nothing waiting on you" description="Held orders, queued orders and blocked or paused listings show up here." />
          ) : (
            <ul className="divide-y divide-rule/70">
              {attention.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} className="flex items-start gap-3 px-4 py-3 hover:bg-sunken/60">
                    <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', a.tone === 'below' ? 'bg-floor' : 'bg-amber')} aria-hidden />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] truncate">{a.label}</span>
                      <span className="block text-[12.5px] text-muted">{a.detail}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 text-faint mt-1 shrink-0" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <HealthPanel health={data?.health} />
      </div>

      <div className="grid lg:grid-cols-3 gap-3 mt-3">
        <Card title="Listings" action={<Link to="/listings" className="text-[13px] text-accent">All listings</Link>}>
          {data ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {([['active', 'Active', 'good'], ['paused', 'Paused', 'thin'], ['draft', 'Draft', 'neutral'], ['blocked', 'Blocked', 'below']] as const).map(([k, label, tone]) => (
                <div key={k} className="flex items-baseline justify-between border-b border-rule/70 pb-1.5">
                  <dt className="text-[13px] text-muted"><Badge tone={tone}>{label}</Badge></dt>
                  <dd className="num font-display text-[22px]">{data.listings[k]}</dd>
                </div>
              ))}
            </dl>
          ) : <div className="h-24 skeleton rounded" />}
        </Card>

        <FloatByOrder rows={data?.float.byOrder} />

        <Card title="Recent activity" padded={false}>
          {data ? (
            data.recentEvents.length === 0 ? <EmptyState compact title="No activity yet" description="Events appear here as Floor syncs, lists and fulfils." /> : (
              <ol className="divide-y divide-rule/70">
                {data.recentEvents.slice(0, 8).map((e) => (
                  <li key={e.id} className="px-4 py-2 flex gap-3 text-[13px]">
                    <span className="flex-1 min-w-0">
                      {e.orderId ? <Link to={`/orders/${e.orderId}`} className="hover:underline">{eventTypeLabel(e.type)}</Link> : eventTypeLabel(e.type)}
                      {e.type === 'sync.completed' && <span className="text-muted"> · {String(e.payload.repriced)} repriced, {String(e.payload.paused)} paused</span>}
                    </span>
                    <time className="text-faint whitespace-nowrap" dateTime={e.at}>{relativeTime(e.at)}</time>
                  </li>
                ))}
              </ol>
            )
          ) : <div className="p-4 h-40 skeleton rounded" />}
        </Card>
      </div>
    </>
  );
}
