import { useEffect, useState } from 'react';
import type { FeeConfig, ListingWithProduct, PricingRule } from '@/api/types';
import { usePatchListing } from '@/api/hooks';
import { FloorApiError, errorMessage } from '@/api/client';
import { Button, Drawer, MoneyField, TextField, useToast } from '@/components/ui';
import { MarginCell } from '@/components/MarginCell';
import { computeMargin, formatCents } from '@/lib/money';

interface Props {
  listing: ListingWithProduct | null;
  rule: Pick<PricingRule, 'floorPct' | 'targetPct'>;
  fees?: FeeConfig;
  onClose: () => void;
}

/** Edit title and price. The price field previews margin live and surfaces the floor when the API returns 422. */
export function EditListingDrawer({ listing, rule, fees, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [priceCents, setPriceCents] = useState(0);
  const [priceError, setPriceError] = useState<string>();
  const patch = usePatchListing();
  const toast = useToast();

  useEffect(() => {
    if (listing) { setTitle(listing.title); setPriceCents(listing.priceCents); setPriceError(undefined); }
  }, [listing]);

  const product = listing?.product;
  const preview = fees && product
    ? computeMargin({ salePriceCents: priceCents, buyerShippingCents: listing.buyerShippingCents, supplierCostCents: product.costCents, supplierShippingCents: product.shippingCents, toolFeeCents: 0, fees })
    : null;
  // The API's floorPriceCents is authoritative (it is what PATCH checks against).
  const floorPrice = listing?.floorPriceCents ?? null;
  const belowFloor = floorPrice !== null ? priceCents < floorPrice : preview ? preview.netMarginPct < rule.floorPct : false;

  const save = () => {
    if (!listing) return;
    patch.mutate({ id: listing.id, title: title.trim(), priceCents }, {
      onSuccess: () => { toast.success('Listing updated'); onClose(); },
      onError: (e) => {
        if (e instanceof FloorApiError && e.code === 'PRICE_BELOW_FLOOR') {
          const floor = (e.details as { floorPriceCents?: number } | undefined)?.floorPriceCents ?? floorPrice;
          setPriceError(floor ? `${formatCents(priceCents)} is below your ${Math.round(rule.floorPct * 100)}% floor. The lowest price that clears it is ${formatCents(floor)}.` : e.message);
        } else toast.error('Could not save', errorMessage(e));
      },
    });
  };

  return (
    <Drawer open={!!listing} onClose={onClose} title="Edit listing" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={patch.isPending} disabled={!title.trim()}>Save changes</Button></>}>
      {listing && (
        <div className="flex flex-col gap-4">
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} hint={`${title.length}/80 characters. eBay cuts titles at 80.`} />
          <MoneyField
            label="Price"
            valueCents={priceCents}
            onChangeCents={(c) => { setPriceCents(c); setPriceError(undefined); }}
            error={priceError}
            hint={floorPrice !== null ? `Lowest price that clears your ${Math.round(rule.floorPct * 100)}% floor: ${formatCents(floorPrice)}` : undefined}
          />
          {preview && product && (
            <div className="rounded-lg bg-sunken/70 border border-rule px-4 py-3 text-[13.5px]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-muted">At {formatCents(priceCents)} this nets</div>
                  <div className="num font-display text-[22px] leading-tight mt-0.5">{formatCents(preview.netProfitCents)}</div>
                </div>
                <MarginCell pct={preview.netMarginPct} rule={rule} size="md" />
              </div>
              <dl className="grid grid-cols-2 gap-y-1 mt-3 text-[12.5px] text-muted">
                <dt>Supplier cost + shipping</dt><dd className="num text-right">-{formatCents(product.costCents + product.shippingCents)}</dd>
                <dt>eBay fees</dt><dd className="num text-right">-{formatCents(preview.ebayFeesCents)}</dd>
              </dl>
              {belowFloor && !priceError && <p className="text-floor mt-2">This price is below your floor. The API will refuse it.</p>}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
