import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { DiscoveryItem } from '@/api/types';
import { useAccount, useCreateListings, useDiscovery } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Badge, Button, Drawer, EmptyState, ErrorState, Table, TableSkeleton, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { MarginCell } from '@/components/MarginCell';
import { Thumb } from '@/components/Thumb';
import { formatCents } from '@/lib/money';
import { complianceLabel } from '@/lib/labels';
import { cn } from '@/lib/cn';
import { CreateResultDrawer, type CreateResult } from '@/components/discovery/CreateResultDrawer';

export function DiscoveryPage() {
  const [q, setQ] = useState('');
  const [minMargin, setMinMargin] = useState<'' | '0.1' | '0.2'>('');
  const [onlyOk, setOnlyOk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CreateResult | null>(null);
  const [detail, setDetail] = useState<DiscoveryItem | null>(null);
  const { data: account } = useAccount();
  const { data, isPending, error, refetch } = useDiscovery({ q, minMarginPct: minMargin ? Number(minMargin) : undefined, pageSize: 100 });
  const create = useCreateListings();
  const toast = useToast();
  const rule = account?.pricingRule ?? { floorPct: 0.1, targetPct: 0.2 };

  const items = useMemo(() => (data?.items ?? []).filter((i) => !onlyOk || i.compliance.ok), [data, onlyOk]);

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const toggleAll = () => {
    const ok = items.filter((i) => i.compliance.ok).map((i) => i.id);
    setSelected((s) => (ok.every((id) => s.has(id)) ? new Set() : new Set(ok)));
  };

  const onCreate = () => {
    const ids = [...selected];
    create.mutate(ids, {
      onSuccess: (res) => {
        setResult({ ...res, products: items.filter((i) => ids.includes(i.id)) });
        setSelected(new Set());
        toast.success(`${res.created.length} draft${res.created.length === 1 ? '' : 's'} created`, res.blocked.length ? `${res.blocked.length} blocked by the compliance gate.` : 'Publish them from Listings.');
      },
      onError: (e) => toast.error('Could not create listings', errorMessage(e)),
    });
  };

  const columns: Column<DiscoveryItem>[] = [
    {
      key: 'sel', header: <input type="checkbox" aria-label="Select all allowed products" className="accent-accent" onChange={toggleAll} checked={items.length > 0 && items.filter((i) => i.compliance.ok).every((i) => selected.has(i.id))} />,
      cell: (i) => (
        <input type="checkbox" aria-label={`Select ${i.title}`} className="accent-accent" disabled={!i.compliance.ok} checked={selected.has(i.id)} onChange={() => toggle(i.id)} onClick={(e) => e.stopPropagation()} />
      ),
      className: 'w-8',
    },
    {
      key: 'product', header: 'Product',
      cell: (i) => (
        <span className="flex items-center gap-3 min-w-0">
          <Thumb src={i.images[0]} className="h-10 w-10" />
          <span className="min-w-0">
            <span className="block truncate max-w-[40vw] md:max-w-[36ch]">{i.title}</span>
            <span className="block text-[12px] text-muted truncate max-w-[40vw] md:max-w-none">{i.categoryHint}, {i.warehouseCountry === 'US' ? 'US warehouse' : `${i.warehouseCountry} warehouse`}, {i.stock} in stock</span>
          </span>
        </span>
      ),
    },
    { key: 'cost', header: 'Cost', align: 'right', hideOnMobile: true, cell: (i) => <span>{formatCents(i.costCents)}{i.shippingCents > 0 && <span className="text-muted"> +{formatCents(i.shippingCents)}</span>}</span> },
    { key: 'price', header: 'Lists at', align: 'right', cell: (i) => <span className="font-medium">{formatCents(i.projectedPriceCents)}</span> },
    { key: 'margin', header: 'Margin', align: 'right', cell: (i) => <MarginCell pct={i.projectedMarginPct} rule={rule} /> },
    {
      key: 'compliance', header: 'Compliance', hideOnMobile: true,
      cell: (i) => i.compliance.ok ? <Badge tone="good">OK</Badge> : <Badge tone="below" title={i.compliance.detail}>{complianceLabel[i.compliance.code]}</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Discovery"
        description="Supplier products priced with your fees and target margin. Pick the ones you want and Floor drafts the listings."
        actions={
          <Button variant="primary" disabled={selected.size === 0} loading={create.isPending} onClick={onCreate}>
            Create {selected.size > 0 ? `${selected.size} ` : ''}listing{selected.size === 1 ? '' : 's'}
          </Button>
        }
      />

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-rule">
          <label className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, category or SKU" aria-label="Search products" className="field pl-8" />
          </label>
          <select value={minMargin} onChange={(e) => setMinMargin(e.target.value as typeof minMargin)} aria-label="Minimum margin" className="field w-auto">
            <option value="">Any margin</option>
            <option value="0.1">Above floor</option>
            <option value="0.2">On target</option>
          </select>
          <label className={cn('inline-flex items-center gap-2 text-[13.5px] px-2 h-9 rounded border cursor-pointer', onlyOk ? 'border-accent bg-accent/8' : 'border-rule')}>
            <input type="checkbox" className="accent-accent" checked={onlyOk} onChange={(e) => setOnlyOk(e.target.checked)} />
            Hide blocked
          </label>
        </div>

        {error ? <ErrorState message={errorMessage(error)} onRetry={() => refetch()} /> : isPending ? <TableSkeleton rows={8} cols={5} /> : items.length === 0 ? (
          <EmptyState title="No products match" description={q ? `Nothing in the catalog matches “${q}”.` : 'Connect a supplier in Settings to see a catalog here.'} action={q ? <Button onClick={() => setQ('')}>Clear search</Button> : <Link to="/settings" className="text-accent underline underline-offset-2 text-[13.5px]">Open Settings</Link>} />
        ) : (
          <Table columns={columns} rows={items} rowKey={(i) => i.id} selected={selected} onRowClick={(i) => setDetail(i)} caption="Supplier products" />
        )}
        {data && <div className="px-3 py-2 text-[12.5px] text-muted border-t border-rule">{items.length} of {data.total} products{selected.size > 0 && ` · ${selected.size} selected`}</div>}
      </div>

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.title ?? ''} footer={detail && (
        <>
          <Button onClick={() => setDetail(null)}>Close</Button>
          <Button variant="primary" disabled={!detail.compliance.ok} onClick={() => { toggle(detail.id); setDetail(null); }}>{selected.has(detail.id) ? 'Remove from selection' : 'Select for listing'}</Button>
        </>
      )}>
        {detail && (
          <div className="flex flex-col gap-4">
            {detail.images[0] && <Thumb src={detail.images[0]} className="w-full aspect-square" />}
            {!detail.compliance.ok && <div className="rounded border border-floor/40 bg-floor/8 px-3 py-2 text-[13.5px]"><strong>{complianceLabel[detail.compliance.code]}.</strong> {detail.compliance.detail}</div>}
            <dl className="grid grid-cols-2 gap-y-2 text-[13.5px]">
              <dt className="text-muted">Supplier cost</dt><dd className="num text-right">{formatCents(detail.costCents)}</dd>
              <dt className="text-muted">Supplier shipping</dt><dd className="num text-right">{formatCents(detail.shippingCents)}</dd>
              <dt className="text-muted">Lists at</dt><dd className="num text-right font-medium">{formatCents(detail.projectedPriceCents)}</dd>
              <dt className="text-muted">Projected margin</dt><dd className="text-right"><MarginCell pct={detail.projectedMarginPct} rule={rule} /></dd>
              <dt className="text-muted">Warehouse</dt><dd className="text-right">{detail.warehouseCountry}</dd>
              <dt className="text-muted">Stock</dt><dd className="num text-right">{detail.stock}</dd>
              <dt className="text-muted">SKU</dt><dd className="text-right">{detail.supplierSku}</dd>
            </dl>
            <p className="text-[13.5px] text-muted leading-relaxed">{detail.description}</p>
          </div>
        )}
      </Drawer>

      <CreateResultDrawer result={result} onClose={() => setResult(null)} />
    </>
  );
}
