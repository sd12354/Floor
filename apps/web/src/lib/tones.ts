import type { ListingStatus, OrderStatus } from '@/api/types';
import type { BadgeTone } from '@/components/ui/Badge';

export const orderStatusTone: Record<OrderStatus, BadgeTone> = {
  paid: 'accent', checking: 'accent', held: 'below', queued: 'thin', awaiting_supplier: 'thin', ordered: 'accent', shipped: 'accent', delivered: 'good', cancelled: 'outline', refunded: 'outline',
};

export const listingStatusTone: Record<ListingStatus, BadgeTone> = {
  active: 'good', paused: 'thin', draft: 'neutral', blocked: 'below', ended: 'outline',
};
