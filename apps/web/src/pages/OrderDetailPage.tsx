import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAccount, useOrder, useOrderDecision } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Badge, Button, Card, ErrorState, Skeleton, useToast } from '@/components/ui';
import { formatCents, formatDate, formatPct } from '@/lib/money';
import { explainLadder, orderStatusLabel } from '@/lib/labels';
import { OrderTimeline } from '@/components/orders/OrderTimeline';
import { OrderPnl } from '@/components/orders/OrderPnl';
import { OrderMessages } from '@/components/orders/OrderMessages';
import { orderStatusTone as statusTone } from '@/lib/tones';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { data: o, isPending, error, refetch } = useOrder(id);
  const { data: account } = useAccount();
  const decide = useOrderDecision();
  const toast = useToast();

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (isPending || !o) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <div className="grid lg:grid-cols-3 gap-3"><Skeleton className="h-64" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      </div>
    );
  }

  const onDecide = (action: 'fulfil' | 'cancel') =>
    decide.mutate({ id: o.id, action }, {
      onSuccess: () => toast.success(action === 'fulfil' ? 'Fulfilling' : 'Cancelled'),
      onError: (e) => toast.error('Could not update order', errorMessage(e)),
    });

  const listingTitle = o.listing?.title;
  const ctx = { floorPct: formatPct(account?.pricingRule.floorPct ?? 0.1, 0) };

  return (
    <>
      <Link to="/orders" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink mb-3"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Orders</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[22px] md:text-[26px] leading-tight">{listingTitle ?? `Order ${o.ebayOrderId}`}</h1>
            <Badge tone={statusTone[o.status]}>{orderStatusLabel[o.status]}</Badge>
          </div>
          <p className="text-[13px] text-muted mt-1">eBay order {o.ebayOrderId} · {o.buyerName} · paid {formatDate(o.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        </div>
        {o.status === 'held' && (
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => onDecide('fulfil')} loading={decide.isPending && decide.variables?.action === 'fulfil'}>Fulfil anyway ({formatCents(o.netProfitCents, { signed: true })})</Button>
            <Button variant="danger" onClick={() => onDecide('cancel')} loading={decide.isPending && decide.variables?.action === 'cancel'}>Cancel order</Button>
          </div>
        )}
      </div>

      {o.status === 'held' && (
        <div className="rounded-lg border border-floor/40 bg-floor/8 px-4 py-3 mb-4 text-[14px]">
          <strong>Held below the floor.</strong> {explainLadder(o.ladderDecision, ctx)} Decide by <strong>{formatDate(o.holdDeadline, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong>; after that Floor cancels it so you are never late.
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-3 items-start">
        <Card title="Timeline" className="lg:row-span-2">
          <OrderTimeline order={o} />
        </Card>

        <OrderPnl order={o} rule={account?.pricingRule} />

        <Card title="Why Floor did this">
          <p className="text-[13.5px] leading-relaxed">{explainLadder(o.ladderDecision, ctx)}</p>
          {o.ladderDecision && (
            <p className="text-[12px] text-muted mt-2">Ladder: {o.ladderDecision.action} · {o.ladderDecision.reason.replace(/_/g, ' ')}</p>
          )}
        </Card>

        <Card title="Shipping">
          <dl className="text-[13.5px] grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted">Ship to</dt>
            <dd>{o.shipTo.name}<br />{o.shipTo.line1}{o.shipTo.line2 && <><br />{o.shipTo.line2}</>}<br />{o.shipTo.city}, {o.shipTo.state} {o.shipTo.postalCode}</dd>
            <dt className="text-muted">Supplier order</dt>
            <dd className="num">{o.supplierOrderId ?? <span className="text-faint">Not placed</span>}</dd>
            <dt className="text-muted">Tracking</dt>
            <dd className="num break-all">{o.trackingNumber ? <>{o.carrier} {o.trackingNumber}</> : <span className="text-faint">{o.status === 'ordered' ? 'Waiting for the supplier' : 'None'}</span>}</dd>
            <dt className="text-muted">Payout</dt>
            <dd>{o.paidOutAt ? <span className="text-green">Paid {formatDate(o.paidOutAt)}</span> : o.payoutExpectedAt ? `Expected ${formatDate(o.payoutExpectedAt)}` : <span className="text-faint">—</span>}</dd>
          </dl>
        </Card>

        <Card title="Messages" className="lg:col-span-2" padded={false}>
          <OrderMessages messages={o.messages} />
        </Card>
      </div>
    </>
  );
}
