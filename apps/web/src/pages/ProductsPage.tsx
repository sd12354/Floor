import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { Product } from '@/api/types';
import { useAccount, useAddSupplier, useManualProducts } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Badge, Button, EmptyState, ErrorState, Table, TableSkeleton, useToast, type Column } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { Thumb } from '@/components/Thumb';
import { ProductFormDrawer } from '@/components/products/ProductFormDrawer';
import { RemoveProductDrawer } from '@/components/products/RemoveProductDrawer';
import { formatCents } from '@/lib/money';

export function ProductsPage() {
  const { data: account } = useAccount();
  const { data, isPending, error, refetch } = useManualProducts();
  const connect = useAddSupplier();
  const toast = useToast();
  const [form, setForm] = useState<'new' | Product | null>(null);
  const [removing, setRemoving] = useState<Product | null>(null);
  const closeForm = useCallback(() => setForm(null), []);
  const closeRemove = useCallback(() => setRemoving(null), []);

  const handlingTimeDays = account?.handlingTimeDays ?? 3;
  const connected = account?.supplierConnections.some((s) => s.supplier === 'manual' && s.status === 'connected');

  const onConnect = () =>
    connect.mutate({ supplier: 'manual' }, {
      onSuccess: () => toast.success('Manual supplier connected'),
      onError: (e) => toast.error('Could not connect', errorMessage(e)),
    });

  const RowActions = ({ p }: { p: Product }) => (
    <span className="inline-flex gap-1">
      <Button size="sm" onClick={() => setForm(p)} aria-label={`Edit ${p.title}`}>Edit</Button>
      <Button size="sm" variant="ghost" onClick={() => setRemoving(p)} aria-label={`Remove ${p.title}`}>Remove</Button>
    </span>
  );

  const columns: Column<Product>[] = [
    {
      key: 'product', header: 'Product',
      cell: (p) => (
        <span className="flex items-center gap-3 min-w-0">
          <Thumb src={p.images[0]} className="h-10 w-10" />
          <span className="min-w-0">
            <span className="block truncate max-w-[52vw] md:max-w-[38ch]">{p.title}</span>
            <span className="block text-[12px] text-muted truncate max-w-[52vw] md:max-w-[44ch]">{p.supplierSku} · {p.warehouseCountry} · {p.stock} in stock · {p.handlingDays} day lead time</span>
            <span className="block md:hidden mt-1.5"><RowActions p={p} /></span>
          </span>
        </span>
      ),
    },
    { key: 'cost', header: 'Cost', align: 'right', cell: (p) => <span>{formatCents(p.costCents)}{p.shippingCents > 0 && <span className="text-muted"> +{formatCents(p.shippingCents)}</span>}</span> },
    { key: 'stock', header: 'Stock', align: 'right', hideOnMobile: true, cell: (p) => <span className={p.stock === 0 ? 'text-floor' : ''}>{p.stock}</span> },
    {
      key: 'lead', header: 'Lead time', align: 'right', hideOnMobile: true,
      cell: (p) => p.handlingDays > handlingTimeDays
        ? <Badge tone="below" title={`Longer than your handling time of ${handlingTimeDays} days, so it cannot be listed`}>{p.handlingDays} days, too slow</Badge>
        : <span>{p.handlingDays} {p.handlingDays === 1 ? 'day' : 'days'}</span>,
    },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', hideOnMobile: true, cell: (p) => <RowActions p={p} /> },
  ];

  return (
    <>
      <PageHeader
        title="Your products"
        description="Products you buy from a wholesaler by hand, like Alibaba or a CJ account without API access. Floor lists them and protects your margin; you place each supplier order after the buyer pays."
        actions={<Button variant="primary" onClick={() => setForm('new')} disabled={connected === false}><Plus className="h-3.5 w-3.5" aria-hidden /> Add product</Button>}
      />

      <div className="panel overflow-hidden">
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => refetch()} /> : isPending || !account ? <TableSkeleton rows={4} cols={4} /> : !connected ? (
          <EmptyState
            title="Connect the Manual supplier first"
            description="It needs no credentials. Once it is connected you can type in your catalog and Floor treats it like any other supplier."
            action={<Button variant="primary" onClick={onConnect} loading={connect.isPending}>Connect Manual supplier</Button>}
          />
        ) : data.items.length === 0 ? (
          <EmptyState
            title="No products yet"
            description="Add what you sell: the cost your supplier charges, its shipping, your lead time and a few photos. It then shows up in Discovery with a projected margin."
            action={<Button variant="primary" onClick={() => setForm('new')}>Add your first product</Button>}
          />
        ) : (
          <Table columns={columns} rows={data.items} rowKey={(p) => p.id} caption="Your products" />
        )}
        {data && data.items.length > 0 && (
          <p className="px-4 py-3 text-[12.5px] text-muted border-t border-rule">
            {data.total} {data.total === 1 ? 'product' : 'products'}. Create listings from them in <Link to="/discovery" className="text-accent underline underline-offset-2">Discovery</Link>. Your handling time is {handlingTimeDays} days; products with a longer lead time cannot be listed.
          </p>
        )}
      </div>

      {form && <ProductFormDrawer key={form === 'new' ? 'new' : form.id} target={form} handlingTimeDays={handlingTimeDays} onClose={closeForm} />}
      {removing && <RemoveProductDrawer product={removing} onClose={closeRemove} />}
    </>
  );
}
