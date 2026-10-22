import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { OrderRow, OrderStatus } from '@/api/types';
import { useAccount, useOrderDecision, useOrders } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Button, Dot, EmptyState, ErrorState, Table, TableSkeleton, Tabs, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatCents, formatDate, marginColorClass, marginState } from '@/lib/money';
import { orderStatusLabel } from '@/lib/labels';
import { cn } from '@/lib/cn';
import { orderStatusTone as statusTone } from '@/lib/tones';

type Tab = 'all' | 'open' | OrderStatus;
const tabs: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'held', label: 'Held' }, { key: 'queued', label: 'Queued' }, { key: 'ordered', label: 'Ordered' }, { key: 'shipped', label: 'Shipped' }, { key: 'delivered', label: 'Delivered' }, { key: 'cancelled', label: 'Cancelled' },
];


export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as Tab | null) ?? 'all';
  const navigate = useNavigate();
  const { data: account } = useAccount();
  const all = useOrders({});
  const { data, isPending, error, refetch } = useOrders(tab === 'all' ? {} : { status: tab });
  const decide = useOrderDecision();
  const toast = useToast();
  const rule = account?.pricingRule ?? { floorPct: 0.1, targetPct: 0.2 };

  const counts = (all.data?.items ?? []).reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.status]: (acc[o.status] ?? 0) + 1 }), {});

  const onDecide = (o: OrderRow, action: 'fulfil' | 'cancel') =>
    decide.mutate({ id: o.id, action }, {
      onSuccess: () => toast.success(action === 'fulfil' ? 'Fulfilling' : 'Cancelled', action === 'fulfil' ? 'Ordered from the supplier at the current price.' : 'The buyer will be refunded by eBay.'),
      onError: (e) => toast.error('Could not update order', errorMessage(e)),
    });

  const netOf = (o: OrderRow) => o.netProfitCents ?? 0;
  const marginOf = (o: OrderRow) => netOf(o) / Math.max(1, o.salePriceCents + o.buyerShippingCents);

  const RowActions = ({ o }: { o: OrderRow }) => o.status === 'held' ? (
    <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="primary" onClick={() => onDecide(o, 'fulfil')} loading={decide.isPending && decide.variables?.id === o.id && decide.variables.action === 'fulfil'}>Fulfil anyway</Button>
      <Button size="sm" variant="danger" onClick={() => onDecide(o, 'cancel')} loading={decide.isPending && decide.variables?.id === o.id && decide.variables.action === 'cancel'}>Cancel</Button>
    </span>
  ) : <Link to={`/orders/${o.id}`} className="text-[13px] text-accent hidden md:inline" onClick={(e) => e.stopPropagation()}>Details</Link>;

  const columns: Column<OrderRow>[] = [
    {
      key: 'order', header: 'Order',
      cell: (o) => (
        <span className="block min-w-0">
          <span className="block truncate max-w-[56vw] md:max-w-[36ch]">{o.listing.title}</span>
          <span className="block text-[12px] text-muted">{o.buyerName} · {formatDate(o.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          {o.status === 'held' && <span className="block text-[12px] text-floor">Decide by {formatDate(o.holdDeadline, { month: 'short', day: 'numeric', hour: 'numeric' })}</span>}
          {o.status === 'held' && <span className="block md:hidden mt-1.5"><RowActions o={o} /></span>}
        </span>
      ),
    },
    { key: 'status', header: 'Status', hideOnMobile: true, cell: (o) => <Dot tone={statusTone[o.status]} label={orderStatusLabel[o.status]} /> },
    { key: 'sale', header: 'Sale', align: 'right', hideOnMobile: true, cell: (o) => formatCents(o.salePriceCents + o.buyerShippingCents) },
    {
      key: 'net', header: 'Net', align: 'right',
      cell: (o) => o.netProfitCents === undefined ? <span className="text-faint">—</span> : (
        <span className={cn('font-medium', o.status === 'cancelled' ? 'text-faint line-through' : marginColorClass[marginState(marginOf(o), rule)])}>{formatCents(o.netProfitCents, { signed: true })}</span>
      ),
    },
    { key: 'payout', header: 'Payout', hideOnMobile: true, cell: (o) => o.paidOutAt ? <span className="text-green">Paid {formatDate(o.paidOutAt)}</span> : o.payoutExpectedAt ? <span className="text-muted">{formatDate(o.payoutExpectedAt)}</span> : <span className="text-faint">—</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', hideOnMobile: true, cell: (o) => <RowActions o={o} /> },
  ];

  return (
    <>
      <PageHeader title="Orders" description="Floor buys from the supplier only after the buyer has paid, and only when the margin still clears your rules." />
      <div className="panel overflow-hidden">
        <div className="px-3 pt-1 min-w-0">
          <Tabs items={tabs.map((t) => ({ ...t, count: t.key === 'all' ? all.data?.total : counts[t.key] ?? 0 }))} value={tab} onChange={(t) => setParams(t === 'all' ? {} : { status: t })} label="Order status" />
        </div>
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => refetch()} /> : isPending ? <TableSkeleton rows={6} cols={6} /> : data.items.length === 0 ? (
          <EmptyState
            title={tab === 'held' ? 'No orders are held' : tab === 'all' ? 'No orders yet' : `No ${tab} orders`}
            description={tab === 'held' ? 'Floor holds an order when the supplier price rises enough to push its margin below your floor.' : tab === 'all' ? 'When a buyer pays on eBay the order appears here. In mock mode, use Simulate sale on an active listing.' : undefined}
            action={tab === 'all' ? <Link to="/listings?status=active" className="inline-flex items-center h-9 px-3.5 rounded bg-accent text-accent-ink text-[14px] font-medium">Go to listings</Link> : undefined}
          />
        ) : (
          <Table columns={columns} rows={data.items} rowKey={(o) => o.id} onRowClick={(o) => navigate(`/orders/${o.id}`)} caption="Orders" />
        )}
      </div>
    </>
  );
}
