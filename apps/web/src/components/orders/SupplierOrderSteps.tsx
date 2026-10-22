import { useState, type FormEvent } from 'react';
import type { OrderDetail } from '@/api/types';
import { useAddTracking, useMarkDelivered } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Button, TextField, useToast } from '@/components/ui';
import { formatCents } from '@/lib/money';

const CARRIERS = ['USPS', 'UPS', 'FedEx', 'DHL', 'YunExpress', '4PX', 'China Post', 'Yanwen'];

/** What was recorded, for the steps after the order has been placed. */
export function OrderedSummary({ order }: { order: OrderDetail }) {
  const total = (order.supplierCostCents ?? 0) + (order.supplierShippingCents ?? 0);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13.5px] mb-4">
      <dt className="text-muted">Supplier order</dt><dd className="num break-all">{order.supplierOrderId}</dd>
      <dt className="text-muted">You paid</dt><dd className="num">{formatCents(total)} <span className="text-muted">({formatCents(order.supplierCostCents)} + {formatCents(order.supplierShippingCents)} shipping)</span></dd>
      {order.trackingNumber && <><dt className="text-muted">Tracking</dt><dd className="num break-all">{order.carrier} {order.trackingNumber}</dd></>}
    </dl>
  );
}

/** Step 3: the supplier has shipped. Floor pushes the number to eBay and messages the buyer. */
export function TrackingStep({ order }: { order: OrderDetail }) {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const add = useAddTracking();
  const toast = useToast();
  const tn = trackingNumber.trim();
  const ca = carrier.trim();
  const errors = {
    tn: tn.length < 1 ? 'Enter the tracking number.' : tn.length > 60 ? 'Use at most 60 characters.' : '',
    ca: ca.length < 1 ? 'Enter the carrier, like USPS or YunExpress.' : ca.length > 40 ? 'Use at most 40 characters.' : '',
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFailure(null);
    const first = errors.tn ? 'tr-number' : errors.ca ? 'tr-carrier' : null;
    if (first) return void document.getElementById(first)?.focus();
    add.mutate({ id: order.id, trackingNumber: tn, carrier: ca }, {
      onSuccess: () => toast.success('Tracking sent to eBay', 'The buyer has been told their order shipped.'),
      onError: (err) => setFailure(errorMessage(err)),
    });
  };

  return (
    <>
      <OrderedSummary order={order} />
      <form onSubmit={submit} noValidate aria-label="Add tracking" className="flex flex-col gap-3.5 max-w-[460px]">
        <p className="text-[13.5px] text-muted leading-relaxed">When your supplier ships it, add the tracking number here. Floor sends it to eBay, which marks the order shipped, and messages the buyer.</p>
        <TextField id="tr-number" label="Tracking number" autoComplete="off" spellCheck={false} value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} error={submitted ? errors.tn : ''} />
        <TextField id="tr-carrier" label="Carrier" autoComplete="off" list="carriers" value={carrier} onChange={(e) => setCarrier(e.target.value)} error={submitted ? errors.ca : ''} hint="Pick one or type your own." />
        <datalist id="carriers">{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
        {failure && <p role="alert" className="text-[13.5px] text-floor">{failure}</p>}
        <div><Button type="submit" variant="primary" loading={add.isPending}>Add tracking and tell the buyer</Button></div>
      </form>
    </>
  );
}

/** Step 4: Floor cannot see a hand-placed parcel arrive, so the seller says when it did. */
export function DeliveredStep({ order }: { order: OrderDetail }) {
  const mark = useMarkDelivered();
  const toast = useToast();
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <>
      <OrderedSummary order={order} />
      <p className="text-[13.5px] text-muted leading-relaxed max-w-[60ch] mb-3">Floor cannot tell when this parcel arrives. Check the tracking, and once it shows delivered, mark it here. That starts the wait for your eBay payout.</p>
      {failure && <p role="alert" className="text-[13.5px] text-floor mb-2">{failure}</p>}
      <Button
        variant="primary"
        loading={mark.isPending}
        onClick={() => { setFailure(null); mark.mutate(order.id, { onSuccess: () => toast.success('Marked delivered'), onError: (e) => setFailure(errorMessage(e)) }); }}
      >
        Mark delivered
      </Button>
    </>
  );
}
