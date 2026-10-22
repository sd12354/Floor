import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import type { SupplierKind } from '@/api/types';
import { useAccount, useAddSupplier, useConnectEbay, usePatchAccount } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Badge, Button, Skeleton, useToast } from '@/components/ui';
import { Wordmark } from '@/components/layout/Wordmark';
import { RulesForm } from '@/components/settings/RulesForm';
import { toPatch, type RulesDraft } from '@/lib/rules';
import { cn } from '@/lib/cn';

const suppliers: { kind: SupplierKind; name: string; blurb: string; ready: boolean }[] = [
  { kind: 'mock', name: 'Mock supplier', blurb: 'A demo catalog of 28 products with live price drift. No credentials. Use it to learn Floor before going real.', ready: true },
  { kind: 'cjdropshipping', name: 'CJdropshipping', blurb: 'US and CN warehouses, API fulfilment. Needs CJ_API_KEY in the API environment.', ready: false },
  { kind: 'spocket', name: 'Spocket', blurb: 'US and EU suppliers, faster shipping. Needs SPOCKET_API_KEY.', ready: false },
  { kind: 'manual', name: 'Manual supplier', blurb: 'Alibaba, a CJ account without API access, or any wholesaler. You type in your products and place each order by hand; Floor still guards your margin. No credentials.', ready: true },
];

function Step({ n, title, complete, children }: { n: number; title: string; complete: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="grid grid-cols-[32px_1fr] gap-x-4">
      <div className="flex flex-col items-center">
        <span className={cn('h-8 w-8 rounded-full flex items-center justify-center text-[13px] font-medium shrink-0', complete ? 'bg-green text-white' : 'border border-rule text-muted')} aria-hidden>{complete ? <Check className="h-4 w-4" /> : n}</span>
        {n < 4 && <span className="w-px flex-1 bg-rule my-2" aria-hidden />}
      </div>
      <div className="pb-8 min-w-0">
        <h2 id={`step-${n}`} className="text-[19px] leading-tight mb-2 pt-1">{title}</h2>
        {children}
      </div>
    </section>
  );
}

export function OnboardingPage() {
  const { data: account } = useAccount();
  const connect = useConnectEbay();
  const addSupplier = useAddSupplier();
  const patch = usePatchAccount();
  const toast = useToast();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const [rulesSaved, setRulesSaved] = useState(false);

  useEffect(() => {
    if (account && !draft) setDraft({ pricingRule: account.pricingRule, fees: account.fees, dailySpendCapCents: account.dailySpendCapCents, smallLossToleranceCents: account.smallLossToleranceCents, handlingTimeDays: account.handlingTimeDays });
  }, [account, draft]);

  const ebayDone = account?.ebayConnected ?? false;
  const supplierDone = account?.supplierConnections.some((s) => s.status === 'connected') ?? false;
  const steps = [ebayDone, supplierDone, rulesSaved, false];
  const done = steps.filter(Boolean).length;

  const onConnect = () =>
    connect.mutate(undefined, {
      onSuccess: (r) => { if ('authorizeUrl' in r) window.location.assign(r.authorizeUrl); else toast.success('eBay connected', `Signed in as ${r.ebayUsername}.`); },
      onError: (e) => toast.error('Could not connect eBay', errorMessage(e)),
    });

  const onSupplier = (kind: SupplierKind) =>
    addSupplier.mutate({ supplier: kind }, {
      onSuccess: (c) => toast.success(`${c.label} connected`),
      onError: (e) => toast.error('Could not connect supplier', errorMessage(e)),
    });

  const onSaveRules = () => draft && patch.mutate(toPatch(draft), {
    onSuccess: () => { setRulesSaved(true); toast.success('Rules saved'); },
    onError: (e) => toast.error('Could not save rules', errorMessage(e)),
  });

  return (
    <div className="min-h-dvh bg-paper">
      <div className="max-w-[720px] mx-auto px-4 py-8 md:py-12">
        <header className="mb-8">
          <Wordmark size="lg" />
          <p className="mt-4 text-[16px] max-w-[52ch] leading-relaxed">Your eBay store, never below the floor. Four steps and Floor lists, syncs and fulfils for you, buying from the supplier only after the buyer has paid.</p>
          <div className="mt-5 flex items-center gap-3 text-[13px] text-muted" aria-live="polite">
            <div className="h-1.5 flex-1 rounded-full bg-sunken overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={4} aria-label="Setup progress">
              <div className="h-full bg-floor rounded-full transition-[width] duration-300" style={{ width: `${(done / 4) * 100}%` }} />
            </div>
            <span className="num">{done} of 4</span>
          </div>
        </header>

        {!account ? <Skeleton className="h-96" /> : (
          <>
            <Step n={1} title="Connect your eBay account" complete={ebayDone}>
              {ebayDone ? (
                <p className="text-[14px]">Connected as <strong>{account.ebayUsername}</strong>. <Badge tone="good">Ready</Badge></p>
              ) : (
                <>
                  <p className="text-[14px] text-muted mb-3 max-w-[56ch]">Floor publishes listings, reads paid orders and pushes tracking through eBay's official API. You can disconnect at any time from eBay's account settings.</p>
                  <Button variant="primary" onClick={onConnect} loading={connect.isPending}>Connect eBay</Button>
                </>
              )}
            </Step>

            <Step n={2} title="Connect a supplier" complete={supplierDone}>
              <div className="grid sm:grid-cols-2 gap-3">
                {suppliers.map((s) => {
                  const connected = account.supplierConnections.find((c) => c.supplier === s.kind);
                  return (
                    <div key={s.kind} className={cn('panel p-3.5 flex flex-col gap-2', connected?.status === 'connected' && 'border-green')}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[14px] font-medium">{s.name}</span>
                        {connected ? <Badge tone={connected.status === 'connected' ? 'good' : 'thin'}>{connected.status === 'connected' ? 'Connected' : 'Needs key'}</Badge> : !s.ready && <Badge tone="outline">Needs API key</Badge>}
                      </div>
                      <p className="text-[12.5px] text-muted flex-1 leading-snug">{s.blurb}</p>
                      {!connected && <Button size="sm" variant={s.ready ? 'primary' : 'secondary'} onClick={() => onSupplier(s.kind)} loading={addSupplier.isPending && addSupplier.variables?.supplier === s.kind} aria-label={`Connect ${s.name}`}>Connect</Button>}
                    </div>
                  );
                })}
              </div>
            </Step>

            <Step n={3} title="Set your floor" complete={rulesSaved}>
              <p className="text-[14px] text-muted mb-4 max-w-[56ch]">Floor never lists or fulfils below the floor. The target is what new listings aim for. Watch the example update as you type.</p>
              {draft && <RulesForm draft={draft} onChange={(d) => { setDraft(d); setRulesSaved(false); }} compact />}
              <div className="mt-4"><Button variant="primary" onClick={onSaveRules} loading={patch.isPending} disabled={!draft || draft.pricingRule.floorPct > draft.pricingRule.targetPct}>{rulesSaved ? 'Saved' : 'Save rules'}</Button></div>
            </Step>

            <Step n={4} title="Pick your first products" complete={false}>
              <p className="text-[14px] text-muted mb-3 max-w-[56ch]">Discovery shows every supplier product priced at your target, with the projected margin and whether it clears the compliance gate. Select a handful, create listings, publish.</p>
              <div className="flex flex-wrap gap-2 items-center">
                <Button variant="primary" disabled={!ebayDone || !supplierDone} onClick={() => navigate('/discovery')}>Open Discovery</Button>
                {ebayDone && supplierDone && <Link to="/" className="text-[13.5px] text-accent underline underline-offset-2">Skip to the dashboard</Link>}
                {(!ebayDone || !supplierDone) && <span className="text-[12.5px] text-muted">Finish steps 1 and 2 first.</span>}
              </div>
            </Step>
          </>
        )}
      </div>
    </div>
  );
}
