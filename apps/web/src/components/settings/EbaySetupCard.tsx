import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/api/client';
import { useEbaySetup } from '@/api/hooks';
import type { EbayCategorySuggestion } from '@/api/types';
import { Button, Card, TextField } from '@/components/ui';
import { composeEnv } from '@/lib/ebaySetup';
import { CopyButton } from '@/components/orders/CopyButton';

const EMPTY = { addressLine1: '', city: '', stateOrProvince: '', postalCode: '' };

export function EbaySetupCard({ connected }: { connected: boolean }) {
  const [addr, setAddr] = useState(EMPTY);
  const [query, setQuery] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof typeof EMPTY, string>>>({});
  const [picked, setPicked] = useState<EbayCategorySuggestion | null>(null);
  const setup = useEbaySetup();
  const result = setup.data;
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setAddr((a) => ({ ...a, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!addr.addressLine1.trim()) next.addressLine1 = 'Enter the street address';
    if (!addr.city.trim()) next.city = 'Enter the city';
    if (!addr.stateOrProvince.trim()) next.stateOrProvince = 'Enter the state';
    if (!addr.postalCode.trim()) next.postalCode = 'Enter the ZIP code';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setPicked(null);
    setup.mutate({
      location: { addressLine1: addr.addressLine1.trim(), city: addr.city.trim(), stateOrProvince: addr.stateOrProvince.trim(), postalCode: addr.postalCode.trim(), country: 'US' },
      ...(query.trim() ? { categoryQuery: query.trim() } : {}),
    });
  };

  const env = result ? composeEnv(result, picked ?? result.categorySuggestions[0] ?? null) : '';

  return (
    <Card title="Set up eBay listing basics">
      <p className="text-[13.5px] text-muted leading-snug mb-3">
        eBay needs shipping, payment and return policies and a ship-from address before it accepts a listing. This creates them once (free shipping, 3 day handling, 30 day returns) and reuses them if they already exist.
        The address is where your parcels ship from; it is sent to eBay and not kept by Floor.
      </p>
      {!connected && <p role="note" className="text-[13.5px] mb-3">Connect your eBay account first, then come back here.</p>}
      <form onSubmit={submit} noValidate className="grid sm:grid-cols-2 gap-3">
        <TextField className="sm:col-span-2" label="Street address" autoComplete="address-line1" value={addr.addressLine1} onChange={set('addressLine1')} error={errors.addressLine1} />
        <TextField label="City" autoComplete="address-level2" value={addr.city} onChange={set('city')} error={errors.city} />
        <TextField label="State" autoComplete="address-level1" placeholder="TX" value={addr.stateOrProvince} onChange={set('stateOrProvince')} error={errors.stateOrProvince} />
        <TextField label="ZIP code" autoComplete="postal-code" inputMode="numeric" value={addr.postalCode} onChange={set('postalCode')} error={errors.postalCode} />
        <TextField label="Country" value="United States" readOnly hint="US only for now." />
        <TextField className="sm:col-span-2" label="What will you sell? (optional)" placeholder="e.g. yoga mat" value={query} onChange={(e) => setQuery(e.target.value)} hint="Used to suggest eBay categories." />
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button type="submit" variant="primary" loading={setup.isPending} disabled={!connected}>Set up my eBay account</Button>
          {setup.isError && <p role="alert" className="text-[13px] text-floor">{errorMessage(setup.error)}</p>}
        </div>
      </form>

      {result && (
        <div className="mt-4 pt-4 border-t border-rule flex flex-col gap-3" aria-live="polite">
          <h3 className="text-[14px]">Done. Your eBay basics are ready.</h3>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="label !mb-0">Lines for apps/api/.env</span>
              <CopyButton text={env} what="the .env lines">Copy</CopyButton>
            </div>
            <pre data-testid="env-lines" className="panel p-3 text-[12.5px] leading-relaxed overflow-x-auto whitespace-pre font-mono">{env}</pre>
            <p className="text-[13px] text-muted mt-2 leading-snug">Paste these lines into <code>apps/api/.env</code>, then restart Floor. Floor does not save them for you.</p>
          </div>
          {result.categorySuggestions.length > 0 && (
            <fieldset>
              <legend className="label">Pick the category for your listings</legend>
              <div className="flex flex-col gap-1.5">
                {result.categorySuggestions.map((c, i) => {
                  const checked = (picked ?? result.categorySuggestions[0])?.categoryId === c.categoryId;
                  return (
                    <label key={c.categoryId} className="flex items-center gap-2 text-[13.5px] cursor-pointer">
                      <input type="radio" name="category" checked={checked} onChange={() => setPicked(c)} />
                      <span>{c.name}</span>
                      <span className="text-muted num text-[12px]">{c.categoryId}{i === 0 ? ' (best match)' : ''}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          {result.notes.map((n) => <p key={n} className="text-[13px] text-muted leading-snug">{n}</p>)}
        </div>
      )}
    </Card>
  );
}
