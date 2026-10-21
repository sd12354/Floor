import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import type { ListingStatus, ListingWithProduct } from '@/api/types';
import { useAccount, useListings, usePatchListing, usePublishListings, useSyncListings } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Badge, Button, Dot, EmptyState, ErrorState, Table, TableSkeleton, Tabs, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { MarginCell } from '@/components/MarginCell';
import { Thumb } from '@/components/Thumb';
import { formatCents, relativeTime } from '@/lib/money';
import { listingStatusLabel, pauseReasonLabel } from '@/lib/labels';
import { listingStatusTone as statusTone } from '@/lib/tones';
import { EditListingDrawer } from '@/components/listings/EditListingDrawer';
import { SimulateSaleDrawer } from '@/components/listings/SimulateSaleDrawer';

type Tab = 'all' | ListingStatus;
const tabs: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'paused', label: 'Paused' }, { key: 'draft', label: 'Draft' }, { key: 'blocked', label: 'Blocked' },
];

export function ListingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as Tab | null) ?? 'all';
  const [editing, setEditing] = useState<ListingWithProduct | null>(null);
  const [simulating, setSimulating] = useState<ListingWithProduct | null>(null);
  const { data: account } = useAccount();
  const all = useListings({});
  const { data, isPending, error, refetch } = useListings(tab === 'all' ? {} : { status: tab });
  const patch = usePatchListing();
  const publish = usePublishListings();
  const sync = useSyncListings();
  const toast = useToast();
  const rule = account?.pricingRule ?? { floorPct: 0.1, targetPct: 0.2 };
  const mockMode = account?.mode === 'mock';

  const counts = (all.data?.items ?? []).reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.status]: (acc[l.status] ?? 0) + 1 }), {});

  const setTab = (t: Tab) => setParams(t === 'all' ? {} : { status: t });

  const onPublish = (l: ListingWithProduct) =>
    publish.mutate([l.id], {
      onSuccess: () => toast.success('Published', `${l.title} is live on eBay.`),
      onError: (e) => toast.error('Could not publish', errorMessage(e)),
    });
  const onPause = (l: ListingWithProduct) =>
    patch.mutate({ id: l.id, status: 'paused' }, {
      onSuccess: () => toast.success('Paused', 'Buyers can no longer purchase this listing.'),
      onError: (e) => toast.error('Could not pause', errorMessage(e)),
    });
  const onSync = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => toast.success('Sync finished', `${r.repriced} repriced, ${r.paused} paused, ${r.resumed} resumed${r.blocked ? `, ${r.blocked} blocked` : ''}.`),
      onError: (e) => toast.error('Sync failed', errorMessage(e)),
    });

  const RowActions = ({ l }: { l: ListingWithProduct }) => (
    <span className="inline-flex gap-1 justify-end flex-wrap">
      {(l.status === 'draft' || l.status === 'paused') && <Button size="sm" variant="primary" onClick={() => onPublish(l)} loading={publish.isPending && publish.variables?.[0] === l.id}>{l.status === 'paused' ? 'Resume' : 'Publish'}</Button>}
      {l.status === 'active' && <Button size="sm" onClick={() => onPause(l)}>Pause</Button>}
      {l.status !== 'blocked' && <Button size="sm" onClick={() => setEditing(l)}>Edit</Button>}
      {mockMode && l.status === 'active' && <Button size="sm" variant="ghost" onClick={() => setSimulating(l)}>Simulate sale</Button>}
    </span>
  );

  const columns: Column<ListingWithProduct>[] = [
    {
      key: 'title', header: 'Listing',
      cell: (l) => (
        <span className="flex items-center gap-3 min-w-0">
          {l.product?.images[0] ? <Thumb src={l.product.images[0]} className="h-9 w-9 hidden sm:block" /> : null}
          <span className="min-w-0">
            <span className="block truncate max-w-[52vw] md:max-w-[34ch]">{l.title}</span>
            <span className="block text-[12px] text-muted truncate max-w-[52vw] md:max-w-[40ch]">
              {l.pauseReason ? <span className={l.status === 'blocked' ? 'text-floor' : 'text-amber'}>{l.status === 'blocked' ? 'Blocked: ' : 'Paused: '}{pauseReasonLabel(l.pauseReason, l)}</span> : l.ebayItemId ? `eBay ${l.ebayItemId}` : 'Not yet on eBay'}
            </span>
            <span className="block md:hidden mt-1.5"><RowActions l={l} /></span>
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', hideOnMobile: true, cell: (l) => <Dot tone={statusTone[l.status]} label={listingStatusLabel[l.status]} /> },
    { key: 'price', header: 'Price', align: 'right', cell: (l) => <span className="font-medium">{formatCents(l.priceCents)}</span> },
    { key: 'margin', header: 'Margin', align: 'right', cell: (l) => <MarginCell pct={l.projectedMarginPct} rule={rule} /> },
    { key: 'stock', header: 'Stock', align: 'right', hideOnMobile: true, cell: (l) => <span className={l.product?.stock === 0 ? 'text-floor' : ''}>{l.product?.stock ?? '—'}</span> },
    { key: 'sync', header: 'Last sync', hideOnMobile: true, cell: (l) => <span className="text-muted whitespace-nowrap">{l.lastSyncAt ? relativeTime(l.lastSyncAt) : 'Never'}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', hideOnMobile: true, cell: (l) => <RowActions l={l} /> },
  ];

  return (
    <>
      <PageHeader
        title="Listings"
        description="Every listing is re-priced and stock-checked on each sync. Anything that falls below your floor is paused, not sold at a loss."
        actions={<Button onClick={onSync} loading={sync.isPending}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Sync now</Button>}
      />
      <div className="panel overflow-hidden">
        <div className="px-3 pt-1 min-w-0">
          <Tabs items={tabs.map((t) => ({ ...t, count: t.key === 'all' ? all.data?.total : counts[t.key] ?? 0 }))} value={tab} onChange={setTab} label="Listing status" />
        </div>
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => refetch()} /> : isPending ? <TableSkeleton rows={6} cols={6} /> : data.items.length === 0 ? (
          <EmptyState
            title={tab === 'all' ? 'No listings yet' : `No ${listingStatusLabel[tab as ListingStatus].toLowerCase()} listings`}
            description={tab === 'all' ? 'Pick products in Discovery and Floor will draft titles and prices for you.' : tab === 'blocked' ? 'Good. Nothing has tripped the compliance gate.' : undefined}
            action={tab === 'all' ? <Link to="/discovery" className="inline-flex items-center h-9 px-3.5 rounded bg-accent text-accent-ink text-[14px] font-medium">Browse Discovery</Link> : undefined}
          />
        ) : (
          <Table columns={columns} rows={data.items} rowKey={(l) => l.id} caption="Listings" />
        )}
        {tab === 'blocked' && data && data.items.length > 0 && (
          <p className="px-4 py-3 text-[12.5px] text-muted border-t border-rule">Blocked listings never go to eBay. <Badge tone="below">Blocked</Badge> items are kept so you can see what was refused and why.</p>
        )}
      </div>

      <EditListingDrawer listing={editing} rule={rule} fees={account?.fees} onClose={() => setEditing(null)} />
      <SimulateSaleDrawer listing={simulating} onClose={() => setSimulating(null)} />
    </>
  );
}
