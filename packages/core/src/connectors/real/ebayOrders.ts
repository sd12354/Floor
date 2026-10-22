import { parseDecimalToCents } from '../../money.js';
import type { Cents } from '../../types.js';
import type { NewOrdersResult, NormalisedEbayOrder } from '../types.js';

interface Amount {
  value?: string;
  currency?: string;
}
interface EbayAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode?: string;
  country?: string;
}
export interface EbayOrder {
  orderId?: string;
  creationDate?: string;
  orderPaymentStatus?: string;
  orderFulfillmentStatus?: string;
  cancelStatus?: { cancelState?: string };
  buyer?: { username?: string };
  pricingSummary?: { priceSubtotal?: Amount; priceDiscountSubtotal?: Amount; deliveryCost?: Amount; deliveryDiscount?: Amount };
  lineItems?: { lineItemId?: string; legacyItemId?: string; quantity?: number }[];
  fulfillmentStartInstructions?: { shippingStep?: { shipTo?: { fullName?: string; contactAddress?: EbayAddress } } }[];
}
export interface EbayOrderPage {
  orders?: EbayOrder[];
  total?: number;
}

/** USD amount to cents; a missing amount is 0, another currency is refused (Floor is USD-only). */
function usd(a: Amount | undefined, label: string): Cents {
  if (!a?.value) return 0;
  if (a.currency && a.currency !== 'USD') throw new Error(`${label} is in ${a.currency}, only USD is supported`);
  return parseDecimalToCents(a.value);
}

/**
 * Map one eBay order to the normalised webhook shape, or explain why it is not safe to.
 * Discounts only ever reduce what we count as revenue (conservative for the margin check): a discount of either sign
 * is applied as a reduction, never an increase.
 */
export function mapEbayOrder(o: EbayOrder): { order: NormalisedEbayOrder } | { skip: string } {
  try {
    if (!o.orderId) return { skip: 'order has no orderId' };
    if (o.orderPaymentStatus !== 'PAID') return { skip: `payment status ${o.orderPaymentStatus ?? 'unknown'}` };
    if (o.cancelStatus?.cancelState && o.cancelStatus.cancelState !== 'NONE_REQUESTED') return { skip: `cancel state ${o.cancelStatus.cancelState}` };
    const lines = o.lineItems ?? [];
    const line = lines[0];
    if (lines.length !== 1 || !line) return { skip: `${lines.length} line items (Floor supports exactly one)` };
    if ((line.quantity ?? 1) !== 1) return { skip: `quantity ${line.quantity} (Floor supports quantity 1)` };
    if (!line.legacyItemId) return { skip: 'line item has no legacyItemId' };
    const ship = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const a = ship?.contactAddress;
    const country = a?.countryCode ?? a?.country;
    if (!ship?.fullName || !a?.addressLine1 || !a.city || !a.stateOrProvince || !a.postalCode || !country) return { skip: 'incomplete ship-to address' };
    const ps = o.pricingSummary;
    const sale = Math.max(0, usd(ps?.priceSubtotal, 'priceSubtotal') - Math.abs(usd(ps?.priceDiscountSubtotal, 'priceDiscountSubtotal')));
    const shipping = Math.max(0, usd(ps?.deliveryCost, 'deliveryCost') - Math.abs(usd(ps?.deliveryDiscount, 'deliveryDiscount')));
    if (sale < 1) return { skip: 'sale price is zero' };
    return {
      order: {
        ebayOrderId: o.orderId,
        ebayItemId: line.legacyItemId,
        buyerName: ship.fullName,
        shipTo: { name: ship.fullName, line1: a.addressLine1, ...(a.addressLine2 ? { line2: a.addressLine2 } : {}), city: a.city, state: a.stateOrProvince, postalCode: a.postalCode, country },
        salePriceCents: sale,
        buyerShippingCents: shipping,
        createdAt: new Date(o.creationDate ?? Date.now()).toISOString(),
      },
    };
  } catch (err) {
    return { skip: err instanceof Error ? err.message : 'unmappable order' };
  }
}

export function mapEbayOrders(orders: readonly EbayOrder[]): NewOrdersResult {
  const out: NewOrdersResult = { orders: [], skipped: [] };
  for (const o of orders) {
    const r = mapEbayOrder(o);
    if ('order' in r) out.orders.push(r.order);
    else out.skipped.push({ ebayOrderId: o.orderId ?? '(unknown)', reason: r.skip });
  }
  return out;
}
