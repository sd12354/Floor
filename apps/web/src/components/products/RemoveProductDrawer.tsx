import { useState } from 'react';
import type { Product } from '@/api/types';
import { useDeleteManualProduct } from '@/api/hooks';
import { FloorApiError, errorMessage } from '@/api/client';
import { Button, Drawer, useToast } from '@/components/ui';

/** Confirm removal. PRODUCT_IN_USE (a live listing or any order points at it) is explained with what to do instead. */
export function RemoveProductDrawer({ product, onClose }: { product: Product; onClose: () => void }) {
  const del = useDeleteManualProduct();
  const toast = useToast();
  const [error, setError] = useState<{ inUse: boolean; message: string } | null>(null);

  const remove = () => {
    setError(null);
    del.mutate(product.id, {
      onSuccess: () => { toast.success('Product removed', 'It no longer appears in Discovery.'); onClose(); },
      onError: (e) => setError({ inUse: e instanceof FloorApiError && e.code === 'PRODUCT_IN_USE', message: errorMessage(e) }),
    });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="sm"
      title="Remove this product?"
      footer={
        <>
          <Button onClick={onClose}>{error?.inUse ? 'Got it' : 'Keep it'}</Button>
          {!error?.inUse && <Button variant="danger" onClick={remove} loading={del.isPending}>Remove product</Button>}
        </>
      }
    >
      <p className="text-[14px]"><strong>{product.title}</strong></p>
      <p className="text-[13.5px] text-muted mt-2 leading-relaxed">Draft listings made from it are deleted with it. This cannot be undone.</p>
      {error && (
        <div role="alert" className="mt-4 rounded border border-floor/40 bg-floor/8 px-3 py-2.5 text-[13.5px] leading-relaxed">
          {error.inUse ? (
            <>
              <strong>It is still in use.</strong> A published listing or an order points at this product, so it has to stay for your records.
              To stop selling it, edit the product and set its stock to 0. That pauses its listings.
            </>
          ) : error.message}
        </div>
      )}
    </Drawer>
  );
}
