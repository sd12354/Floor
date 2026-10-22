import type { ComplianceCode, LadderDecision, LedgerKind, MessageKind, OrderStatus, ListingStatus } from '@/api/types';

export const orderStatusLabel: Record<OrderStatus, string> = {
  paid: 'Paid',
  checking: 'Checking margin',
  held: 'Held',
  queued: 'Queued',
  awaiting_supplier: 'To order',
  ordered: 'Ordered',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export const listingStatusLabel: Record<ListingStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
  blocked: 'Blocked',
};

export const complianceLabel: Record<ComplianceCode, string> = {
  SUPPLIER_NOT_ALLOWED: 'Supplier not allowed',
  VERO_MATCH: 'Brand on VeRO list',
  RESTRICTED_CATEGORY: 'Restricted category',
  NO_IMAGES: 'No images',
  HANDLING_TIME_EXCEEDED: 'Ships too slowly',
};

/** What to do about a compliance refusal, where there is something the seller can change. */
export function complianceAdvice(code: ComplianceCode, supplier?: string): string | undefined {
  if (code !== 'HANDLING_TIME_EXCEEDED') return undefined;
  return supplier === 'manual'
    ? 'Shorten the lead time on Your products, or raise your handling time in Settings. Until then this product cannot be listed.'
    : 'Raise your handling time in Settings, or pick a faster supplier. Until then this product cannot be listed.';
}

/** Human text for a listing's pauseReason (a pause code or, when blocked, a compliance code). */
export function pauseReasonLabel(reason: string | undefined, l: { floorPriceCents?: number } = {}): string | undefined {
  if (!reason) return undefined;
  if (reason === 'HANDLING_TIME_EXCEEDED') return 'Lead time is longer than your handling time';
  if (reason in complianceLabel) return complianceLabel[reason as ComplianceCode];
  switch (reason) {
    case 'below_floor':
      return l.floorPriceCents ? `Supplier cost rose; needs at least $${(l.floorPriceCents / 100).toFixed(2)} to clear your floor` : 'Supplier cost rose above what the price can cover';
    case 'out_of_stock':
      return 'Supplier out of stock';
    case 'manual':
      return 'Paused by you';
    default:
      return reason.replace(/_/g, ' ');
  }
}

export const ledgerKindLabel: Record<LedgerKind, string> = {
  sale: 'Sale',
  ebay_fee: 'eBay fee',
  supplier_cost: 'Supplier cost',
  supplier_shipping: 'Supplier shipping',
  refund: 'Refund',
  payout: 'Payout',
};

export const messageKindLabel: Record<MessageKind, string> = {
  order_confirmed: 'Confirmation',
  shipped: 'Shipped',
  delivered: 'Delivered',
  wismo: 'Where is my order',
  cancel: 'Cancel request',
  return: 'Return request',
  other: 'Other',
};

/** Plain-words explanation of a ladder decision for the order detail page. */
export function explainLadder(d: LadderDecision | undefined, ctx: { floorPct: string; manual?: boolean }): string {
  if (!d) return 'The margin check has not run yet.';
  switch (d.action) {
    case 'fulfil':
      if (ctx.manual) return `The margin at the moment of sale still cleared your ${ctx.floorPct} floor, so Floor moved the order to To order. Your supplier has no API, so you place the supplier order by hand.`;
      return d.reason === 'within_tolerance'
        ? `The supplier price at the moment of sale still cleared your ${ctx.floorPct} margin floor, so Floor ordered from the supplier right away.`
        : 'This order was fulfilled as a small loss under an earlier rule that no longer applies. Floor now holds anything below your margin floor.';
    case 'hold':
      return `The supplier price rose far enough that this order fell below your ${ctx.floorPct} margin floor. Floor held it for you to decide before the handling deadline.`;
    case 'cancel':
      return d.reason === 'out_of_stock'
        ? 'The supplier had no stock and no backup was available, so Floor cancelled the order before any money changed hands.'
        : 'No decision was made before the handling deadline, so Floor cancelled the order rather than ship late.';
  }
}

export const eventTypeLabel = (type: string): string =>
  ({
    'order.paid': 'Buyer paid',
    'order.checking': 'Re-checked supplier price and margin',
    'order.held': 'Held below floor',
    'order.queued': 'Queued: daily spend cap reached',
    'order.awaiting_supplier': 'Waiting for you to order from your supplier',
    'order.supplier_ordered': 'You ordered from your supplier',
    'order.delivered_manual': 'You marked it delivered',
    'order.ordered': 'Ordered from supplier',
    'order.shipped': 'Tracking pushed to eBay',
    'order.delivered': 'Delivered',
    'order.payout': 'eBay payout received',
    'order.cancelled': 'Cancelled',
    'order.decision': 'Your decision',
    'listing.created': 'Listing drafted',
    'listing.published': 'Listing published',
    'listing.paused': 'Listing paused',
    'listing.resumed': 'Listing resumed',
    'listing.repriced': 'Listing repriced',
    'listing.blocked': 'Listing blocked',
    'sync.completed': 'Price and stock sync completed',
    'message.sent': 'Message sent to buyer',
    'message.received': 'Message from buyer',
  })[type] ?? type.replace(/[._]/g, ' ');
