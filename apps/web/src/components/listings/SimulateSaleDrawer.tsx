import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ListingWithProduct } from '@/api/types';
import { useAccount, useSimulateSale } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Button, Drawer, TextField, useToast } from '@/components/ui';
import { MarginCell } from '@/components/MarginCell';
import { computeMargin, formatCents } from '@/lib/money';
import { orderStatusLabel } from '@/lib/labels';

/** Mock-mode only: create a paid order for this listing with an optional supplier price drift, so the ladder can be watched. */
export function SimulateSaleDrawer({ listing, onClose }: { listing: ListingWithProduct | null; onClose: () => void }) {
  const [drift, setDrift] = useState(0);
  const [buyer, setBuyer] = useState('');
  const { data: account } = useAccount();
  const sim = useSimulateSale();
  const toast = useToast();
  const navigate = useNavigate();

  const product = listing?.product;
  const cost = product ? Math.round(product.costCents * (1 + drift / 100)) : 0;
  const preview = account && listing && product
    ? computeMargin({ salePriceCents: listing.priceCents, buyerShippingCents: listing.buyerShippingCents, supplierCostCents: cost, supplierShippingCents: product.shippingCents, toolFeeCents: 0, fees: account.fees })
    : null;

  const expected = (() => {
    if (!preview || !account) return '';
    if (preview.netMarginPct >= account.pricingRule.floorPct) {
      return product?.supplier === 'manual'
        ? 'Margin clears your floor, so the order will wait in To order for you to buy from your supplier.'
        : 'Margin clears your floor, so Floor will order from the supplier immediately.';
    }
    const outcome = preview.netProfitCents >= 0 ? `Net profit would be only ${formatCents(preview.netProfitCents)}` : `This order would lose ${formatCents(-preview.netProfitCents)}`;
    return `${outcome}, below your margin floor. Floor will hold the order and ask you to decide.`;
  })();

  const run = () => {
    if (!listing) return;
    // CONTRACT: priceDriftPct is a percentage (60 = +60%), not a fraction.
    sim.mutate({ listingId: listing.id, buyerName: buyer || undefined, priceDriftPct: drift }, {
      onSuccess: (o) => {
        toast.success(`Order ${orderStatusLabel[o.status].toLowerCase()}`, o.status === 'held' ? 'Decide on it from Orders.' : o.status === 'queued' ? 'Daily cap reached; it will order after midnight.' : 'Tracking appears in a few seconds.');
        onClose();
        navigate(`/orders/${o.id}`);
      },
      onError: (e) => toast.error('Simulation failed', errorMessage(e)),
    });
  };

  return (
    <Drawer open={!!listing} onClose={onClose} title="Simulate a sale" width="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={run} loading={sim.isPending}>Create paid order</Button></>}>
      {listing && product && (
        <div className="flex flex-col gap-4">
          <p className="text-[13.5px] text-muted">Creates a paid eBay order for <strong className="text-ink">{listing.title}</strong> at {formatCents(listing.priceCents)} and runs it through the pipeline.</p>
          <TextField label="Buyer name" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Simulated Buyer" />
          <div>
            <label htmlFor="drift" className="label">Supplier price drift: <span className="num text-ink">{drift > 0 ? '+' : ''}{drift}%</span></label>
            <input id="drift" type="range" min={-30} max={120} step={5} value={drift} onChange={(e) => setDrift(Number(e.target.value))} className="w-full accent-accent" />
            <p className="text-[12.5px] text-muted mt-1">Pretend the supplier changed price since the listing synced. Push it up to see the ladder hold the order.</p>
          </div>
          {preview && (
            <div className="rounded-lg bg-sunken/70 border border-rule px-4 py-3 text-[13.5px]">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="text-muted">Supplier cost at sale time</div>
                  <div className="num font-display text-[22px] leading-tight mt-0.5">{formatCents(cost)}<span className="text-[13px] text-muted font-sans"> was {formatCents(product.costCents)}</span></div>
                </div>
                <MarginCell pct={preview.netMarginPct} rule={account?.pricingRule ?? { floorPct: 0.1, targetPct: 0.2 }} size="md" />
              </div>
              <p className="mt-3">{expected}</p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
