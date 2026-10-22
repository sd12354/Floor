import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Product } from '@/api/types';
import { useCreateManualProduct, usePatchManualProduct } from '@/api/hooks';
import { FloorApiError, errorMessage } from '@/api/client';
import { Button, Drawer, DollarField, TextAreaField, TextField, useToast } from '@/components/ui';
import {
  diffInput, draftFromProduct, emptyDraft, fieldOrder, parseImageLines, toInput, validateDraft, type DraftField, type ProductDraft,
} from '@/lib/manualProduct';

interface Props {
  /** `'new'` to add, a product to edit. Remount (key) per target so the form starts fresh. */
  target: 'new' | Product;
  handlingTimeDays: number;
  onClose: () => void;
}

const fieldId = (f: DraftField) => `mp-${f}`;

/** Add or edit one manual product. Every field in CONTRACT.md → Manual supplier, validated against the same ranges. */
export function ProductFormDrawer({ target, handlingTimeDays, onClose }: Props) {
  const editing = target === 'new' ? null : target;
  const [draft, setDraft] = useState<ProductDraft>(() => (editing ? draftFromProduct(editing) : emptyDraft));
  const [touched, setTouched] = useState<Set<DraftField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<{ code: string; message: string } | null>(null);
  const create = useCreateManualProduct();
  const patch = usePatchManualProduct();
  const toast = useToast();

  const errors = validateDraft(draft);
  const shown = (f: DraftField) => (submitted || touched.has(f) ? errors[f] : undefined);
  const set = (f: DraftField) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [f]: e.target.value }));
  const blur = (f: DraftField) => () => setTouched((t) => new Set(t).add(f));
  const bind = (f: DraftField) => ({ id: fieldId(f), value: draft[f], onChange: set(f), onBlur: blur(f), error: shown(f) });

  const invalidFields = fieldOrder.filter((f) => errors[f]);
  const pending = create.isPending || patch.isPending;
  const days = Number(draft.handlingDays);
  const slow = /^\d+$/.test(draft.handlingDays.trim()) && days > handlingTimeDays;

  const fail = (e: unknown) => setServerError({ code: e instanceof FloorApiError ? e.code : 'ERROR', message: errorMessage(e) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const first = invalidFields[0];
    if (first) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    const input = toInput(draft);
    if (editing) {
      const changes = diffInput(editing, input);
      if (Object.keys(changes).length === 0) return onClose();
      patch.mutate({ id: editing.id, ...changes }, {
        onSuccess: () => { toast.success('Product updated', 'Listings for it are re-checked against the new numbers.'); onClose(); },
        onError: fail,
      });
    } else {
      create.mutate(input, {
        onSuccess: (p) => { toast.success('Product added', `${p.title} is now in Discovery.`); onClose(); },
        onError: fail,
      });
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={editing ? 'Edit product' : 'Add a product'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="product-form" variant="primary" loading={pending}>{editing ? 'Save changes' : 'Add product'}</Button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {submitted && invalidFields.length > 0 && (
          <p role="alert" className="rounded border border-floor/40 bg-floor/8 px-3 py-2 text-[13.5px]">
            {invalidFields.length === 1 ? 'One field needs fixing.' : `${invalidFields.length} fields need fixing.`} They are marked below.
          </p>
        )}
        {serverError && (
          <p role="alert" className="rounded border border-floor/40 bg-floor/8 px-3 py-2 text-[13.5px]">
            {serverError.code === 'SUPPLIER_NOT_CONNECTED'
              ? <>Connect the Manual supplier first, then add the product. <Link to="/settings" className="text-accent underline underline-offset-2">Open Settings</Link></>
              : serverError.message}
          </p>
        )}

        <TextField label="Title" maxLength={120} autoComplete="off" hint="3 to 80 characters. Floor drafts the eBay title from this." {...bind('title')} />
        <TextAreaField label="Description" rows={4} hint="Shown on the eBay listing. Describe what the buyer receives." {...bind('description')} />
        <TextAreaField
          label="Image URLs"
          rows={4}
          spellCheck={false}
          placeholder="https://..."
          hint="One https:// link per line, 1 to 12. The first is the main photo."
          {...bind('images')}
        />
        <p className="text-[12.5px] text-muted -mt-3" aria-live="polite">{parseImageLines(draft.images).length} of 12 images</p>

        <div className="grid grid-cols-2 gap-3">
          <DollarField label="Cost per unit" hint="What the supplier charges for one item." {...bind('cost')} />
          <DollarField label="Supplier shipping" hint="Per order. Enter 0 if it is free." {...bind('shipping')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Stock" inputMode="numeric" hint="Units you can supply. 0 pauses its listings." {...bind('stock')} />
          <TextField label="Warehouse country" maxLength={2} className="uppercase" hint="2-letter code, like CN or US." {...bind('warehouseCountry')} />
        </div>
        <TextField
          label="Lead time (days)"
          inputMode="numeric"
          keepHint
          hint={
            <>
              Days from your order until it reaches the buyer. It must not exceed your handling time of {handlingTimeDays} {handlingTimeDays === 1 ? 'day' : 'days'}, or the listing cannot be published.
              {slow && <strong className="block text-amber mt-0.5">Longer than your handling time. Floor will block this product from listing until you shorten it or <Link to="/settings" className="underline underline-offset-2">raise your handling time</Link>.</strong>}
            </>
          }
          {...bind('handlingDays')}
        />
        <TextField label="Supplier link (optional)" type="url" inputMode="url" spellCheck={false} placeholder="https://" hint="Only shown to you, on the order screen. Floor never opens it." {...bind('supplierUrl')} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Brand (optional)" hint="Checked against the VeRO list." {...bind('brand')} />
          <TextField label="Category (optional)" {...bind('categoryHint')} />
        </div>
      </form>
    </Drawer>
  );
}
