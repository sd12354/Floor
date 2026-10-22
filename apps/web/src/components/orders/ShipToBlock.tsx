import type { Address } from '@/api/types';
import { CopyButton } from './CopyButton';
import { addressText } from '@/lib/address';

const rows = (a: Address): { label: string; value: string }[] =>
  [
    { label: 'Name', value: a.name ?? '' },
    { label: 'Address line 1', value: a.line1 },
    { label: 'Address line 2', value: a.line2 ?? '' },
    { label: 'City', value: a.city },
    { label: 'State', value: a.state },
    { label: 'Postal code', value: a.postalCode },
    { label: 'Country', value: a.country },
  ].filter((r) => r.value.trim() !== '');

/** Ship-to, one field per row with its own copy button, because supplier checkouts ask for them one box at a time. */
export function ShipToBlock({ shipTo }: { shipTo: Address }) {
  return (
    <section aria-labelledby="shipto-h">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <h3 id="shipto-h" className="text-[14px] font-medium font-sans">Ship to the buyer</h3>
        <CopyButton text={addressText(shipTo)} what="full address">Copy full address</CopyButton>
      </div>
      <dl className="border border-rule rounded divide-y divide-rule/70">
        {rows(shipTo).map((r) => (
          <div key={r.label} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 pl-3 pr-1 py-0.5">
            <dt className="text-[12.5px] text-muted">{r.label}</dt>
            <dd className="text-[14px] break-words min-w-0">{r.value}</dd>
            <dd><CopyButton text={r.value} what={r.label.toLowerCase()} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
