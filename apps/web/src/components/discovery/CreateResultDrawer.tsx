import { Link } from 'react-router-dom';
import type { CreateListingsResponse, DiscoveryItem } from '@/api/types';
import { Badge, Button, Drawer } from '@/components/ui';
import { formatCents } from '@/lib/money';
import { complianceAdvice, complianceLabel } from '@/lib/labels';

export type CreateResult = CreateListingsResponse & { products: DiscoveryItem[] };

/** What happened after "Create listings": drafts made, and what the compliance gate refused and why. */
export function CreateResultDrawer({ result, onClose }: { result: CreateResult | null; onClose: () => void }) {
  const titleOf = (productId: string) => result?.products.find((p) => p.id === productId)?.title ?? productId;
  const adviceFor = (b: CreateResult['blocked'][number]) =>
    b.compliance.ok ? undefined : complianceAdvice(b.compliance.code, result?.products.find((p) => p.id === b.productId)?.supplier);
  return (
    <Drawer
      open={!!result}
      onClose={onClose}
      title="Listings created"
      footer={
        <>
          <Button onClick={onClose}>Keep browsing</Button>
          <Link to="/listings?status=draft" className="inline-flex items-center h-9 px-3.5 rounded bg-accent text-accent-ink text-[14px] font-medium">Review drafts</Link>
        </>
      }
    >
      {result && (
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="text-[14px] font-medium mb-2">{result.created.length} draft{result.created.length === 1 ? '' : 's'} ready to publish</h3>
            {result.created.length === 0 ? <p className="text-[13.5px] text-muted">Nothing passed the gate.</p> : (
              <ul className="divide-y divide-rule/70 border border-rule rounded">
                {result.created.map((l) => (
                  <li key={l.id} className="px-3 py-2 flex justify-between gap-3 text-[13.5px]">
                    <span className="truncate">{l.title}</span>
                    <span className="num shrink-0">{formatCents(l.priceCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {result.blocked.length > 0 && (
            <section>
              <h3 className="text-[14px] font-medium mb-2">{result.blocked.length} blocked</h3>
              <ul className="divide-y divide-rule/70 border border-floor/30 rounded">
                {result.blocked.map((b) => (
                  <li key={b.productId} className="px-3 py-2 text-[13.5px]">
                    <div className="flex justify-between gap-3">
                      <span className="truncate">{titleOf(b.productId)}</span>
                      {!b.compliance.ok && <Badge tone="below">{complianceLabel[b.compliance.code]}</Badge>}
                    </div>
                    {!b.compliance.ok && <p className="text-muted text-[12.5px] mt-0.5">{b.compliance.detail}{adviceFor(b) && <> {adviceFor(b)}</>}</p>}
                  </li>
                ))}
              </ul>
              <p className="text-[12.5px] text-muted mt-2">Blocked products never reach eBay. This protects your account from VeRO takedowns and policy strikes.</p>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
