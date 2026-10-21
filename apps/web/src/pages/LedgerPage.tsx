import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { LedgerEntry } from '@/api/types';
import { useLedger } from '@/api/hooks';
import { API_BASE, errorMessage } from '@/api/client';
import { EmptyState, ErrorState, Table, TableSkeleton, type Column } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatCents, formatDateTime } from '@/lib/money';
import { ledgerKindLabel } from '@/lib/labels';
import { cn } from '@/lib/cn';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

export function LedgerPage() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(iso(new Date()));
  const { data, isPending, error, refetch } = useLedger({ from, to });

  const columns: Column<LedgerEntry>[] = [
    { key: 'at', header: 'When', cell: (e) => <span className="text-muted whitespace-nowrap">{formatDateTime(e.at)}</span> },
    { key: 'kind', header: 'Entry', cell: (e) => ledgerKindLabel[e.kind] },
    { key: 'order', header: 'Order', hideOnMobile: true, cell: (e) => e.orderId ? <Link to={`/orders/${e.orderId}`} className="text-accent">{e.orderId}</Link> : <span className="text-faint">—</span> },
    { key: 'amount', header: 'Amount', align: 'right', cell: (e) => <span className={cn('font-medium', e.amountCents < 0 ? 'text-ink' : 'text-green')}>{formatCents(e.amountCents, { signed: true })}</span> },
  ];

  const t = data?.totals;
  const totals: { label: string; value: number | undefined; tone?: string }[] = [
    { label: 'Revenue', value: t?.revenueCents },
    { label: 'eBay fees', value: t?.feesCents },
    { label: 'Supplier cost', value: t?.costCents },
    { label: 'Net profit', value: t?.profitCents, tone: t && t.profitCents < 0 ? 'text-floor' : 'text-green' },
  ];

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every cent in and out, by order. Payouts are what eBay has actually sent you."
        actions={
          <a href={`${API_BASE}/ledger/export.csv`} download="floor-ledger.csv" className="inline-flex items-center gap-2 h-9 px-3.5 rounded border border-rule bg-surface text-[14px] font-medium hover:bg-sunken">
            <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
          </a>
        }
      />
      <div className="panel">
        <div className="flex flex-wrap items-end gap-3 p-3 border-b border-rule">
          <label className="text-[13px] text-muted">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="field mt-1 w-auto" /></label>
          <label className="text-[13px] text-muted">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="field mt-1 w-auto" /></label>
          <div className="flex gap-1 pb-1">
            {([7, 30, 90] as const).map((n) => (
              <button key={n} type="button" aria-label={`Last ${n} days`} onClick={() => { setFrom(daysAgo(n)); setTo(iso(new Date())); }} className="text-[13px] px-2 py-1 rounded hover:bg-sunken text-muted hover:text-ink">{n}d</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-rule border-b border-rule">
          {totals.map((x) => (
            <div key={x.label} className="px-4 py-3">
              <div className="text-[12.5px] text-muted">{x.label}</div>
              <div className={cn('num font-display text-[22px] leading-tight', x.tone)}>{x.value === undefined ? <span className="skeleton inline-block h-5 w-20 rounded" /> : formatCents(x.value)}</div>
            </div>
          ))}
        </div>

        {error ? <ErrorState message={errorMessage(error)} onRetry={() => refetch()} /> : isPending ? <TableSkeleton rows={8} cols={4} /> : data.entries.length === 0 ? (
          <EmptyState title="Nothing in this range" description="Widen the dates, or simulate a sale from Listings to see entries appear." />
        ) : (
          <Table columns={columns} rows={data.entries} rowKey={(e) => e.id} caption="Ledger entries" />
        )}
      </div>
    </>
  );
}
