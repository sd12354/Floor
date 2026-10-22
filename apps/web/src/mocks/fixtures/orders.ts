import type { Address, Event, LedgerEntry, Message, Order } from '@/api/types';

const ship = (name: string, city: string, state: string, zip: string): Address => ({
  name, line1: '1400 Oak Street', city, state, postalCode: zip, country: 'US',
});

type Spec = Partial<Order> & Pick<Order, 'id' | 'listingId' | 'buyerName' | 'salePriceCents' | 'status' | 'createdAt'>;

const mk = (s: Spec): Order => ({
  accountId: 'acc_demo',
  ebayOrderId: `eb-${s.id.slice(4)}-${s.createdAt.slice(5, 10).replace('-', '')}`,
  buyerShippingCents: 0,
  shipTo: ship(s.buyerName, 'Austin', 'TX', '78701'),
  updatedAt: s.createdAt,
  ...s,
});

/**
 * Six orders with money out but no payout yet (ordered/shipped/delivered) → float.
 * Plus one held, one queued, one cancelled, two paid out.
 */
export const orders: Order[] = [
  // Float
  mk({ id: 'ord_1041', listingId: 'lst_01', buyerName: 'Maya Lindqvist', salePriceCents: 1899, status: 'delivered', supplierOrderId: 'MS-88211', supplierCostCents: 1180, supplierShippingCents: 0, trackingNumber: '9400111899223456781', carrier: 'USPS', ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, payoutExpectedAt: '2026-10-21T00:00:00Z', netProfitCents: 421, createdAt: '2026-10-14T15:22:00Z', updatedAt: '2026-10-18T19:00:00Z' }),
  mk({ id: 'ord_1042', listingId: 'lst_04', buyerName: 'Devon Park', salePriceCents: 2199, status: 'delivered', supplierOrderId: 'MS-88230', supplierCostCents: 1380, supplierShippingCents: 0, trackingNumber: '9400111899223456802', carrier: 'USPS', ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, payoutExpectedAt: '2026-10-22T00:00:00Z', netProfitCents: 480, createdAt: '2026-10-15T09:48:00Z', updatedAt: '2026-10-19T14:30:00Z' }),
  mk({ id: 'ord_1043', listingId: 'lst_02', buyerName: 'Priya Raman', salePriceCents: 3499, status: 'shipped', supplierOrderId: 'MS-88302', supplierCostCents: 2240, supplierShippingCents: 0, trackingNumber: '1Z999AA10123456784', carrier: 'UPS', ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, payoutExpectedAt: '2026-10-25T00:00:00Z', netProfitCents: 743, createdAt: '2026-10-17T11:05:00Z', updatedAt: '2026-10-18T08:12:00Z' }),
  mk({ id: 'ord_1044', listingId: 'lst_07', buyerName: 'Tomás Herrera', salePriceCents: 1499, status: 'shipped', supplierOrderId: 'MS-88318', supplierCostCents: 860, supplierShippingCents: 150, trackingNumber: 'YT2029221266000123', carrier: 'YunExpress', ladderDecision: { action: 'fulfil', reason: 'small_loss' }, payoutExpectedAt: '2026-10-27T00:00:00Z', netProfitCents: -5, createdAt: '2026-10-17T19:40:00Z', updatedAt: '2026-10-19T02:00:00Z' }),
  mk({ id: 'ord_1045', listingId: 'lst_05', buyerName: 'Hannah Okafor', salePriceCents: 1299, status: 'ordered', supplierOrderId: 'MS-88377', supplierCostCents: 720, supplierShippingCents: 0, ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, payoutExpectedAt: '2026-10-28T00:00:00Z', netProfitCents: 362, createdAt: '2026-10-19T16:12:00Z', updatedAt: '2026-10-19T16:13:00Z' }),
  mk({ id: 'ord_1046', listingId: 'lst_08', buyerName: 'Chris Albers', salePriceCents: 2199, status: 'ordered', supplierOrderId: 'MS-88391', supplierCostCents: 1240, supplierShippingCents: 190, ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, payoutExpectedAt: '2026-10-29T00:00:00Z', netProfitCents: 430, createdAt: '2026-10-20T07:31:00Z', updatedAt: '2026-10-20T07:32:00Z' }),
  // Held: supplier price jumped
  mk({ id: 'ord_1047', listingId: 'lst_06', buyerName: 'Lena Fischer', salePriceCents: 999, status: 'held', supplierCostCents: 940, supplierShippingCents: 120, ladderDecision: { action: 'hold', reason: 'below_floor', deadline: '2026-10-22T19:55:00Z' }, holdDeadline: '2026-10-22T19:55:00Z', netProfitCents: -237, createdAt: '2026-10-20T07:55:00Z', updatedAt: '2026-10-20T07:56:00Z' }),
  // Queued: daily cap reached
  mk({ id: 'ord_1048', listingId: 'lst_03', buyerName: 'Sam Whitfield', salePriceCents: 2299, status: 'queued', supplierCostCents: 1460, supplierShippingCents: 0, ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, netProfitCents: 486, createdAt: '2026-10-20T09:02:00Z', updatedAt: '2026-10-20T09:02:00Z' }),
  // To order: manual supplier, waiting for the seller to buy it. Nothing is in the ledger yet.
  mk({ id: 'ord_1049', listingId: 'lst_14', buyerName: 'Elena Rossi', salePriceCents: 2499, status: 'awaiting_supplier', shipTo: { name: 'Elena Rossi', line1: '88 Harbor View Drive', line2: 'Apt 4B', city: 'Portland', state: 'OR', postalCode: '97204', country: 'US' }, ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, createdAt: '2026-10-20T10:15:00Z', updatedAt: '2026-10-20T10:15:05Z' }),
  // Paid out
  mk({ id: 'ord_1039', listingId: 'lst_03', buyerName: 'Jordan Ellis', salePriceCents: 2299, status: 'delivered', supplierOrderId: 'MS-88102', supplierCostCents: 1460, supplierShippingCents: 0, trackingNumber: '9400111899223450011', carrier: 'USPS', ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, payoutExpectedAt: '2026-10-16T00:00:00Z', paidOutAt: '2026-10-16T05:00:00Z', netProfitCents: 486, createdAt: '2026-10-09T13:10:00Z', updatedAt: '2026-10-16T05:00:00Z' }),
  mk({ id: 'ord_1040', listingId: 'lst_01', buyerName: 'Ava Nguyen', salePriceCents: 1899, status: 'delivered', supplierOrderId: 'MS-88150', supplierCostCents: 1180, supplierShippingCents: 0, trackingNumber: '9400111899223450098', carrier: 'USPS', ladderDecision: { action: 'fulfil', reason: 'within_tolerance' }, payoutExpectedAt: '2026-10-18T00:00:00Z', paidOutAt: '2026-10-18T05:00:00Z', netProfitCents: 421, createdAt: '2026-10-11T20:45:00Z', updatedAt: '2026-10-18T05:00:00Z' }),
  // Cancelled: out of stock
  mk({ id: 'ord_1038', listingId: 'lst_10', buyerName: 'Noor Haddad', salePriceCents: 2799, status: 'cancelled', ladderDecision: { action: 'cancel', reason: 'out_of_stock' }, createdAt: '2026-10-12T08:30:00Z', updatedAt: '2026-10-12T08:31:00Z' }),
];

const ev = (id: string, orderId: string, type: string, at: string, payload: Record<string, unknown> = {}): Event => ({
  id, accountId: 'acc_demo', orderId, type, payload, at,
});

export const events: Event[] = [
  ev('evt_01', 'ord_1043', 'order.paid', '2026-10-17T11:05:00Z', { salePriceCents: 3499 }),
  ev('evt_02', 'ord_1043', 'order.checking', '2026-10-17T11:05:04Z', { supplierCostCents: 2240, netMarginPct: 0.212 }),
  ev('evt_03', 'ord_1043', 'order.ordered', '2026-10-17T11:05:09Z', { supplierOrderId: 'MS-88302' }),
  ev('evt_04', 'ord_1043', 'order.shipped', '2026-10-18T08:12:00Z', { carrier: 'UPS', trackingNumber: '1Z999AA10123456784' }),
  ev('evt_05', 'ord_1047', 'order.paid', '2026-10-20T07:55:00Z', { salePriceCents: 999 }),
  ev('evt_06', 'ord_1047', 'order.checking', '2026-10-20T07:55:03Z', { supplierCostCents: 940, previousCostCents: 530, netMarginPct: -0.237 }),
  ev('evt_07', 'ord_1047', 'order.held', '2026-10-20T07:56:00Z', { deadline: '2026-10-22T19:55:00Z' }),
  ev('evt_08', 'ord_1048', 'order.paid', '2026-10-20T09:02:00Z', { salePriceCents: 2299 }),
  ev('evt_09', 'ord_1048', 'order.checking', '2026-10-20T09:02:02Z', { supplierCostCents: 1460, netMarginPct: 0.211 }),
  ev('evt_10', 'ord_1048', 'order.queued', '2026-10-20T09:02:03Z', { spentTodayCents: 49480, capCents: 50000 }),
  ev('evt_11', 'ord_1046', 'order.paid', '2026-10-20T07:31:00Z', { salePriceCents: 2199 }),
  ev('evt_12', 'ord_1046', 'order.checking', '2026-10-20T07:31:02Z', { supplierCostCents: 1240, netMarginPct: 0.196 }),
  ev('evt_13', 'ord_1046', 'order.ordered', '2026-10-20T07:32:00Z', { supplierOrderId: 'MS-88391' }),
  ev('evt_14', 'ord_1041', 'order.paid', '2026-10-14T15:22:00Z', {}),
  ev('evt_15', 'ord_1041', 'order.checking', '2026-10-14T15:22:03Z', { netMarginPct: 0.222 }),
  ev('evt_16', 'ord_1041', 'order.ordered', '2026-10-14T15:22:08Z', { supplierOrderId: 'MS-88211' }),
  ev('evt_17', 'ord_1041', 'order.shipped', '2026-10-15T13:00:00Z', { carrier: 'USPS' }),
  ev('evt_18', 'ord_1041', 'order.delivered', '2026-10-18T19:00:00Z', {}),
  { id: 'evt_19', accountId: 'acc_demo', listingId: 'lst_09', type: 'listing.paused', payload: { reason: 'below_floor' }, at: '2026-10-20T06:00:00Z' },
  { id: 'evt_20', accountId: 'acc_demo', type: 'sync.completed', payload: { repriced: 3, paused: 1, resumed: 0 }, at: '2026-10-20T06:00:00Z' },
  ev('evt_22', 'ord_1049', 'order.paid', '2026-10-20T10:15:00Z', { salePriceCents: 2499 }),
  ev('evt_23', 'ord_1049', 'order.checking', '2026-10-20T10:15:03Z', { supplierCostCents: 1240, netMarginPct: 0.228 }),
  ev('evt_24', 'ord_1049', 'order.awaiting_supplier', '2026-10-20T10:15:05Z', {}),
  ev('evt_21', 'ord_1040', 'order.payout', '2026-10-18T05:00:00Z', { amountCents: 1899 }),
];

export const messages: Message[] = [
  { id: 'msg_01', accountId: 'acc_demo', orderId: 'ord_1043', direction: 'out', kind: 'order_confirmed', answered: true, body: 'Thanks for your order, Priya. Your LED desk lamp is being prepared and will ship within 3 business days.', at: '2026-10-17T11:06:00Z' },
  { id: 'msg_02', accountId: 'acc_demo', orderId: 'ord_1043', direction: 'out', kind: 'shipped', answered: true, body: 'Your order has shipped with UPS. Tracking: 1Z999AA10123456784.', at: '2026-10-18T08:13:00Z' },
  { id: 'msg_03', accountId: 'acc_demo', orderId: 'ord_1044', direction: 'in', kind: 'wismo', answered: false, body: 'Hi, tracking has not updated in 2 days. Is my order still coming?', suggestedReply: 'Hi Tomás, thanks for checking in. Your resistance bands shipped on Oct 19 with YunExpress (YT2029221266000123). International tracking often pauses for a few days during customs handoff and then updates all at once. Expected delivery is Oct 24–27. I will keep an eye on it and reach out if anything changes.', at: '2026-10-20T08:40:00Z' },
  { id: 'msg_04', accountId: 'acc_demo', orderId: 'ord_1047', direction: 'in', kind: 'cancel', answered: false, body: 'Please cancel, I ordered the wrong color.', suggestedReply: 'Hi Lena, no problem. I have cancelled your order and the refund of $9.99 will reach your original payment method within 3–5 business days. Sorry it was not quite right.', at: '2026-10-20T08:15:00Z' },
  { id: 'msg_05', accountId: 'acc_demo', orderId: 'ord_1041', direction: 'in', kind: 'other', answered: false, body: 'Arrived today, works great. Thanks!', suggestedReply: 'So glad it arrived and works well, Maya. Enjoy the coffee, and thanks for shopping with us.', at: '2026-10-18T21:02:00Z' },
];

const le = (id: string, orderId: string, kind: LedgerEntry['kind'], amountCents: number, at: string): LedgerEntry => ({
  id, accountId: 'acc_demo', orderId, kind, amountCents, at,
});

export const ledger: LedgerEntry[] = [
  le('led_01', 'ord_1039', 'sale', 2299, '2026-10-09T13:10:00Z'),
  le('led_02', 'ord_1039', 'ebay_fee', -353, '2026-10-09T13:10:00Z'),
  le('led_03', 'ord_1039', 'supplier_cost', -1460, '2026-10-09T13:10:10Z'),
  le('led_04', 'ord_1039', 'payout', 1946, '2026-10-16T05:00:00Z'),
  le('led_05', 'ord_1040', 'sale', 1899, '2026-10-11T20:45:00Z'),
  le('led_06', 'ord_1040', 'ebay_fee', -298, '2026-10-11T20:45:00Z'),
  le('led_07', 'ord_1040', 'supplier_cost', -1180, '2026-10-11T20:45:08Z'),
  le('led_08', 'ord_1040', 'payout', 1601, '2026-10-18T05:00:00Z'),
  le('led_09', 'ord_1041', 'sale', 1899, '2026-10-14T15:22:00Z'),
  le('led_10', 'ord_1041', 'ebay_fee', -298, '2026-10-14T15:22:00Z'),
  le('led_11', 'ord_1041', 'supplier_cost', -1180, '2026-10-14T15:22:08Z'),
  le('led_12', 'ord_1042', 'sale', 2199, '2026-10-15T09:48:00Z'),
  le('led_13', 'ord_1042', 'ebay_fee', -339, '2026-10-15T09:48:00Z'),
  le('led_14', 'ord_1042', 'supplier_cost', -1380, '2026-10-15T09:48:07Z'),
  le('led_15', 'ord_1043', 'sale', 3499, '2026-10-17T11:05:00Z'),
  le('led_16', 'ord_1043', 'ebay_fee', -516, '2026-10-17T11:05:00Z'),
  le('led_17', 'ord_1043', 'supplier_cost', -2240, '2026-10-17T11:05:09Z'),
  le('led_18', 'ord_1044', 'sale', 1499, '2026-10-17T19:40:00Z'),
  le('led_19', 'ord_1044', 'ebay_fee', -244, '2026-10-17T19:40:00Z'),
  le('led_20', 'ord_1044', 'supplier_cost', -860, '2026-10-17T19:40:06Z'),
  le('led_21', 'ord_1044', 'supplier_shipping', -150, '2026-10-17T19:40:06Z'),
  le('led_22', 'ord_1045', 'sale', 1299, '2026-10-19T16:12:00Z'),
  le('led_23', 'ord_1045', 'ebay_fee', -217, '2026-10-19T16:12:00Z'),
  le('led_24', 'ord_1045', 'supplier_cost', -720, '2026-10-19T16:13:00Z'),
  le('led_25', 'ord_1046', 'sale', 2199, '2026-10-20T07:31:00Z'),
  le('led_26', 'ord_1046', 'ebay_fee', -339, '2026-10-20T07:31:00Z'),
  le('led_27', 'ord_1046', 'supplier_cost', -1240, '2026-10-20T07:32:00Z'),
  le('led_28', 'ord_1046', 'supplier_shipping', -190, '2026-10-20T07:32:00Z'),
];
