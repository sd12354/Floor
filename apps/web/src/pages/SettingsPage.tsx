import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { SupplierKind } from '@/api/types';
import { useAccount, useAddSupplier, usePatchAccount, useRemoveSupplier } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Badge, Button, Card, ErrorState, Skeleton, TextField, useToast } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';
import { RulesForm } from '@/components/settings/RulesForm';
import { EbaySetupCard } from '@/components/settings/EbaySetupCard';
import { adRateError, rulesFromAccount, toPatch, type RulesDraft } from '@/lib/rules';


const supplierNames: Record<SupplierKind, string> = { mock: 'Mock supplier', cjdropshipping: 'CJdropshipping', spocket: 'Spocket', manual: 'Manual supplier' };

export function SettingsPage() {
  const { data: account, isPending, error, refetch } = useAccount();
  const [draft, setDraft] = useState<RulesDraft | null>(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState<SupplierKind>('cjdropshipping');
  const patch = usePatchAccount();
  const addSupplier = useAddSupplier();
  const removeSupplier = useRemoveSupplier();
  const toast = useToast();

  useEffect(() => { if (account) { setDraft(rulesFromAccount(account)); setName(account.name); } }, [account]);

  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;
  if (isPending || !account || !draft) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-96" /></div>;

  const dirty = JSON.stringify({ ...draft, name }) !== JSON.stringify({ ...rulesFromAccount(account), name: account.name });
  const invalid = draft.pricingRule.floorPct > draft.pricingRule.targetPct || adRateError(draft) !== null;

  const save = () =>
    patch.mutate({ ...toPatch(draft), name: name.trim() || account.name }, {
      onSuccess: () => toast.success('Settings saved', draft.promotedAdsEnabled !== account.promotedAdsEnabled || (draft.promotedAdsEnabled && draft.promotedAdRatePct !== account.promotedAdRatePct) ? 'Live listings were re-priced for the ad rate.' : 'Listings will be re-priced on the next sync.'),
      onError: (e) => toast.error('Could not save', errorMessage(e)),
    });

  return (
    <>
      <PageHeader
        title="Settings"
        description="The rules Floor applies to every listing and every order."
        actions={<Button variant="primary" onClick={save} loading={patch.isPending} disabled={!dirty || invalid}>Save changes</Button>}
      />
      <div className="grid lg:grid-cols-[1fr_320px] gap-3 items-start">
        <div className="flex flex-col gap-3">
          <Card title="Pricing and risk">
            <RulesForm draft={draft} onChange={setDraft} adsPending={account.promotedAdsPending} />
          </Card>
          <Card title="Account">
            <div className="grid sm:grid-cols-2 gap-4">
              <TextField label="Store name" value={name} onChange={(e) => setName(e.target.value)} />
              <div>
                <span className="label">eBay</span>
                <div className="flex items-center gap-2 h-9">
                  {account.ebayConnected ? <><Badge tone="good">Connected</Badge><span className="text-[13.5px]">{account.ebayUsername}</span></> : <Badge tone="below">Not connected</Badge>}
                </div>
              </div>
            </div>
          </Card>
          <EbaySetupCard connected={account.ebayConnected} />
        </div>

        <Card title="Suppliers">
          <ul className="divide-y divide-rule/70 -mt-1">
            {account.supplierConnections.length === 0 && <li className="py-2 text-[13.5px] text-muted">No suppliers connected. Discovery will be empty until you add one.</li>}
            {account.supplierConnections.map((s) => (
              <li key={s.id} className="py-2.5 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[14px] truncate">{s.label}</span>
                  <span className="block text-[12px] text-muted">{supplierNames[s.supplier]}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <Badge tone={s.status === 'connected' ? 'good' : s.status === 'error' ? 'below' : 'thin'}>{s.status === 'connected' ? 'Connected' : s.status === 'error' ? 'Error' : 'Needs API key'}</Badge>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${s.label}`} onClick={() => removeSupplier.mutate(s.id, { onSuccess: () => toast.success('Supplier removed'), onError: (e) => toast.error('Could not remove', errorMessage(e)) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 pt-3 border-t border-rule flex gap-2">
            <select value={adding} onChange={(e) => setAdding(e.target.value as SupplierKind)} className="field flex-1" aria-label="Supplier to add">
              <option value="mock">Mock supplier</option>
              <option value="cjdropshipping">CJdropshipping</option>
              <option value="spocket">Spocket</option>
              <option value="manual">Manual supplier (Alibaba, CJ, any wholesaler)</option>
            </select>
            <Button onClick={() => addSupplier.mutate({ supplier: adding }, { onSuccess: (c) => toast.success(`${c.label} added`), onError: (e) => toast.error('Could not add supplier', errorMessage(e)) })} loading={addSupplier.isPending}>Add</Button>
          </div>
          {account.supplierConnections.some((s) => s.supplier === 'manual') && (
            <p className="text-[13px] mt-3">
              <Link to="/products" className="text-accent underline underline-offset-2">Manage your products</Link>
              <span className="text-muted"> for the manual supplier.</span>
            </p>
          )}
          <p className="text-[12px] text-muted mt-3 leading-snug">Only allow-listed wholesale suppliers can be connected. Retail sites like Amazon or Walmart are never supported; eBay bans drop-shipping from them.</p>
        </Card>
      </div>
    </>
  );
}
