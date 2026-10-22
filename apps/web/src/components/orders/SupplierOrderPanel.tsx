import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { OrderDetail, PricingRule } from '@/api/types';
import { useOrderDecision } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Button, Card, useToast } from '@/components/ui';
import { ShipToBlock } from './ShipToBlock';
import { SupplierOrderForm } from './SupplierOrderForm';
import { DeliveredStep, TrackingStep } from './SupplierOrderSteps';
import { formatCents, formatPct } from '@/lib/money';
import { isHttpsUrl } from '@/lib/manualProduct';
import { cn } from '@/lib/cn';

const steps = [
  { status: 'awaiting_supplier', label: 'Order from supplier' },
  { status: 'ordered', label: 'Add tracking' },
  { status: 'shipped', label: 'Mark delivered' },
] as const;

function StepList({ status }: { status: OrderDetail['status'] }) {
  const current = steps.findIndex((s) => s.status === status);
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] mb-4" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.status} aria-current={i === current ? 'step' : undefined} className={cn('flex items-center gap-1.5', i === current ? 'text-ink font-medium' : i < current ? 'text-muted line-through' : 'text-faint')}>
          <span className={cn('h-5 w-5 rounded-full text-[11px] flex items-center justify-center border', i === current ? 'border-floor text-floor' : 'border-rule')} aria-hidden>{i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function CancelOrder({ order }: { order: OrderDetail }) {
  const [asking, setAsking] = useState(false);
  const decide = useOrderDecision();
  const toast = useToast();
  if (!asking) return <Button variant="ghost" size="sm" onClick={() => setAsking(true)}>Cancel this order</Button>;
  return (
    <div className="rounded border border-rule px-3 py-2.5 text-[13.5px]" role="group" aria-label="Confirm cancelling the order">
      <p>Cancel this order on eBay? The buyer is refunded and nothing is spent. This cannot be undone.</p>
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="danger" loading={decide.isPending} onClick={() => decide.mutate({ id: order.id, action: 'cancel' }, { onSuccess: () => toast.success('Order cancelled'), onError: (e) => toast.error('Could not cancel', errorMessage(e)) })}>Yes, cancel the order</Button>
        <Button size="sm" onClick={() => setAsking(false)}>Keep it</Button>
      </div>
    </div>
  );
}

/** "Order from your supplier": the manual-supplier workflow on the order screen, one step at a time. */
export function SupplierOrderPanel({ order, rule }: { order: OrderDetail; rule: Pick<PricingRule, 'floorPct' | 'targetPct'> }) {
  const supplier = order.supplier;
  if (!supplier) return null;
  const max = order.maxSupplierCostCents;
  const url = supplier.url && isHttpsUrl(supplier.url) ? supplier.url : undefined;
  const host = url ? new URL(url).hostname.replace(/^www\./, '') : undefined;

  if (order.status === 'ordered') return <Card title="Add tracking" className="mb-3"><StepList status={order.status} /><TrackingStep order={order} /></Card>;
  if (order.status === 'shipped') return <Card title="Mark delivered" className="mb-3"><StepList status={order.status} /><DeliveredStep order={order} /></Card>;
  if (order.status !== 'awaiting_supplier') return null;

  return (
    <Card title="Order from your supplier" className="mb-3">
      <StepList status={order.status} />
      <div className="grid lg:grid-cols-2 gap-x-8 gap-y-5">
        <div className="flex flex-col gap-4 min-w-0">
          <div>
            <div className="text-[13px] text-muted">Pay at most</div>
            <div className="num font-display text-[44px] leading-none mt-1">{max === undefined ? '—' : formatCents(max)}</div>
            <div className="floor-rule w-10 mt-2.5" aria-hidden />
            <p className="text-[13px] text-muted mt-2 leading-relaxed max-w-[52ch]">
              {max === 0
                ? `No supplier price clears your ${formatPct(rule.floorPct, 0)} floor on this sale.`
                : `For the item and your supplier's shipping together. Pay more and this order drops below your ${formatPct(rule.floorPct, 0)} floor.`}{' '}
              The buyer paid {formatCents(order.salePriceCents + order.buyerShippingCents)}.
            </p>
          </div>

          <div className="text-[14px]">
            <div className="text-[13px] text-muted">Buy this</div>
            <div className="font-medium">{supplier.title}</div>
            <div className="text-[12.5px] text-muted">SKU {supplier.supplierSku}</div>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-accent underline underline-offset-2 break-all">
                Open on {host} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <p className="text-[12.5px] text-muted mt-1">No supplier link saved. Add one by editing the product in Your products.</p>
            )}
          </div>

          <ShipToBlock shipTo={order.shipTo} />
        </div>

        <div className="min-w-0">
          <h3 className="text-[14px] font-medium font-sans mb-2">Check your margin, then record the order</h3>
          <SupplierOrderForm order={order} rule={rule} />
          <div className="mt-5 pt-4 border-t border-rule"><CancelOrder order={order} /></div>
        </div>
      </div>
    </Card>
  );
}
