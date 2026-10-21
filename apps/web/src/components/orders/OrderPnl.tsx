import type { OrderDetail, PricingRule } from '@/api/types';
import { Card } from '@/components/ui';
import { formatCents, formatPct, marginColorClass, marginState } from '@/lib/money';
import { cn } from '@/lib/cn';

/** Sale, fees, supplier, net. Ledger entries are the source of truth when present; else the order's own numbers. */
export function OrderPnl({ order, rule }: { order: OrderDetail; rule?: Pick<PricingRule, 'floorPct' | 'targetPct'> }) {
  const sum = (kinds: string[]) => order.ledger.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.amountCents, 0);
  const hasLedger = order.ledger.length > 0;
  const sale = hasLedger ? sum(['sale']) : order.salePriceCents + order.buyerShippingCents;
  const fees = hasLedger ? sum(['ebay_fee']) : null;
  const supplier = hasLedger && order.ledger.some((e) => e.kind === 'supplier_cost') ? sum(['supplier_cost', 'supplier_shipping']) : order.supplierCostCents !== undefined ? -((order.supplierCostCents ?? 0) + (order.supplierShippingCents ?? 0)) : null;
  const refund = hasLedger ? sum(['refund']) : 0;
  const net = order.netProfitCents ?? (fees !== null && supplier !== null ? sale + fees + supplier + refund : undefined);
  const margin = net !== undefined ? net / Math.max(1, sale) : undefined;
  const state = margin !== undefined && rule ? marginState(margin, rule) : undefined;
  // `cancelled` means nothing was spent; `refunded` means the supplier order was placed and the buyer refunded.
  const cancelled = order.status === 'cancelled';

  const Row = ({ label, value, muted }: { label: string; value: number | null; muted?: boolean }) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-rule/70 text-[13.5px]">
      <span className={muted ? 'text-muted' : ''}>{label}</span>
      <span className="num">{value === null ? <span className="text-faint">pending</span> : formatCents(value, { signed: true })}</span>
    </div>
  );

  return (
    <Card title="Profit and loss">
      <Row label="Sale (item + shipping)" value={sale} />
      <Row label="eBay fees" value={fees} muted />
      <Row label="Supplier cost + shipping" value={supplier} muted />
      {refund !== 0 && <Row label="Refund" value={refund} muted />}
      <div className="flex justify-between items-end gap-3 pt-3">
        <span className="text-[13.5px]">Net {cancelled && <span className="text-muted">(cancelled, nothing spent)</span>}</span>
        <span className="text-right">
          <span className={cn('num font-display text-[26px] leading-none', state ? marginColorClass[state] : '')}>{cancelled ? formatCents(0) : formatCents(net, { signed: true })}</span>
          {margin !== undefined && !cancelled && <span className="block text-[12px] text-muted mt-1">{formatPct(margin)} of sale</span>}
        </span>
      </div>
    </Card>
  );
}
