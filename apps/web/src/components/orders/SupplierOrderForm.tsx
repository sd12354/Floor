import { useState, type FormEvent } from 'react';
import type { BelowFloorDetails, OrderDetail, PricingRule } from '@/api/types';
import { useRecordSupplierOrder, useSupplierQuote } from '@/api/hooks';
import { FloorApiError, errorMessage } from '@/api/client';
import { Button, DollarField, TextField, useToast } from '@/components/ui';
import { MarginReadout } from './MarginReadout';
import { MAX_MONEY_CENTS, formatCents, formatPct, parseCents } from '@/lib/money';
import { useDebouncedValue } from '@/lib/useDebounced';

const isBelowFloor = (d: unknown): d is BelowFloorDetails =>
  typeof d === 'object' && d !== null && typeof (d as BelowFloorDetails).maxSupplierCostCents === 'number' && typeof (d as BelowFloorDetails).netMarginPct === 'number';

interface Refusal { amounts: string; details: BelowFloorDetails }

/**
 * Step 2 of a manual order: type what the supplier quoted, watch the margin, pay them, then record the order here.
 * The same two amount boxes feed the live check and the record, so what was checked is what is saved.
 */
export function SupplierOrderForm({ order, rule }: { order: OrderDetail; rule: Pick<PricingRule, 'floorPct' | 'targetPct'> }) {
  const [cost, setCost] = useState('');
  const [shipping, setShipping] = useState('');
  const [supplierOrderId, setSupplierOrderId] = useState('');
  // The confirmation belongs to the exact amounts it was given for: any edit to either box clears it, even if the numbers come back.
  const [confirmedKey, setConfirmedKey] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const record = useRecordSupplierOrder();
  const toast = useToast();

  const costCents = parseCents(cost);
  const shippingCents = parseCents(shipping);
  const amountsOk = costCents !== null && costCents > 0 && costCents <= MAX_MONEY_CENTS && shippingCents !== null && shippingCents <= MAX_MONEY_CENTS;
  const amountsKey = amountsOk ? `${costCents}:${shippingCents}` : '';
  const confirm = confirmedKey !== '' && confirmedKey === amountsKey;

  // Debounced so each keystroke does not hit the API; the query is keyed by the amounts, so answers can not arrive out of order.
  const settledCost = useDebouncedValue(cost);
  const settledShipping = useDebouncedValue(shipping);
  const settledCents = { c: parseCents(settledCost), s: parseCents(settledShipping) };
  const settledOk = settledCents.c !== null && settledCents.c > 0 && settledCents.c <= MAX_MONEY_CENTS && settledCents.s !== null && settledCents.s <= MAX_MONEY_CENTS;
  const quoteQ = useSupplierQuote(order.id, settledOk ? { costCents: settledCents.c ?? 0, shippingCents: settledCents.s ?? 0 } : null);
  const quote = amountsOk ? quoteQ.data : undefined;
  const stale = amountsOk && (settledCost !== cost || settledShipping !== shipping || quoteQ.isPlaceholderData || quoteQ.isFetching);
  const quoteCurrent = amountsOk && !stale && !!quoteQ.data;

  // Below the floor if the live check says so, or the server refused these exact amounts.
  const belowFloor = (quoteCurrent && quoteQ.data?.meetsFloor === false) || (refusal !== null && refusal.amounts === amountsKey);
  const details = refusal && refusal.amounts === amountsKey ? refusal.details : undefined;
  const netForConfirm = quoteCurrent ? quoteQ.data?.netProfitCents : details?.netProfitCents;
  const floorLabel = formatPct(rule.floorPct, Number.isInteger(Number((rule.floorPct * 100).toFixed(4))) ? 0 : 2);

  const idTrimmed = supplierOrderId.trim();
  const errors = {
    cost: costCents === null ? 'Enter a dollar amount, like 12.50.' : costCents <= 0 ? 'Cost must be more than $0.00.' : costCents > MAX_MONEY_CENTS ? 'Cost can be at most $1,000,000.00.' : '',
    shipping: shippingCents === null ? 'Enter what you paid for shipping. Use 0 if it was free.' : shippingCents > MAX_MONEY_CENTS ? 'Shipping can be at most $1,000,000.00.' : '',
    id: idTrimmed.length < 1 ? 'Paste the order number your supplier gave you.' : idTrimmed.length > 100 ? 'Use at most 100 characters.' : '',
    confirm: belowFloor && !confirm ? 'Tick the box to confirm you want to record an order below your floor.' : '',
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFailure(null);
    const first = (['cost', 'shipping', 'id', 'confirm'] as const).find((k) => errors[k]);
    if (first) return void document.getElementById(`so-${first}`)?.focus();
    if (amountsOk && !quoteCurrent && !quoteQ.isError) return setFailure('Still checking your margin. Try again in a moment.');

    record.mutate(
      { id: order.id, supplierOrderId: idTrimmed, costCents: costCents ?? 0, shippingCents: shippingCents ?? 0, ...(belowFloor && confirm ? { confirmBelowFloor: true } : {}) },
      {
        onSuccess: () => toast.success('Supplier order recorded', 'Add the tracking number when your supplier ships it.'),
        onError: (err) => {
          if (err instanceof FloorApiError && err.code === 'BELOW_FLOOR' && isBelowFloor(err.details)) setRefusal({ amounts: amountsKey, details: err.details });
          else setFailure(errorMessage(err));
        },
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3.5" aria-label="Record your supplier order">
      <div className="grid grid-cols-2 gap-3">
        <DollarField id="so-cost" label="Item cost" hint="What they quoted for the item." value={cost} onChange={(e) => { setCost(e.target.value); setConfirmedKey(''); }} error={show('cost')} />
        <DollarField id="so-shipping" label="Shipping" hint="Enter 0 if free." value={shipping} onChange={(e) => { setShipping(e.target.value); setConfirmedKey(''); }} error={show('shipping')} />
      </div>

      <MarginReadout quote={quote} stale={stale} error={quoteQ.isError && amountsOk ? errorMessage(quoteQ.error) : undefined} totalCents={amountsOk ? (costCents ?? 0) + (shippingCents ?? 0) : null} rule={rule} />

      {refusal && (
        <div role="alert" className="rounded border border-floor/50 bg-floor/8 px-3 py-2.5 text-[13.5px] leading-relaxed">
          <strong>Floor did not record this order.</strong> At these amounts the margin is{' '}
          <strong>{formatPct(refusal.details.netMarginPct, 2)}</strong> (net {formatCents(refusal.details.netProfitCents, { signed: true })}), below your {floorLabel} floor. The most you can pay is <strong>{formatCents(refusal.details.maxSupplierCostCents)}</strong>.
          Ask your supplier for a lower price, or confirm below to record it anyway.
        </div>
      )}

      {belowFloor && (
        <div className="rounded border border-floor/40 px-3 py-2.5">
          <label className="flex items-start gap-2.5 cursor-pointer text-[13.5px]">
            <input
              id="so-confirm"
              type="checkbox"
              className="accent-floor mt-0.5 h-4 w-4"
              checked={confirm}
              onChange={(e) => setConfirmedKey(e.target.checked ? amountsKey : '')}
              aria-invalid={!!show('confirm')}
              aria-describedby={show('confirm') ? 'so-confirm-err' : undefined}
            />
            <span>
              I know this order is below my {floorLabel} floor{netForConfirm !== undefined && <> (net {formatCents(netForConfirm, { signed: true })})</>}, and I want to record it anyway.
            </span>
          </label>
          {show('confirm') && <p id="so-confirm-err" className="text-[12.5px] text-floor mt-1.5">{errors.confirm}</p>}
        </div>
      )}

      <TextField
        id="so-id"
        label="Supplier order number"
        hint="The order or reference number from your supplier, after you have paid."
        autoComplete="off"
        value={supplierOrderId}
        onChange={(e) => setSupplierOrderId(e.target.value)}
        error={show('id')}
      />

      {failure && <p role="alert" className="text-[13.5px] text-floor">{failure}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={record.isPending}>Record supplier order</Button>
        <span className="text-[12.5px] text-muted">Costs go in your ledger. Nothing is sent to your supplier.</span>
      </div>
    </form>
  );
}
