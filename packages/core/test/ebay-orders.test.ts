import { describe, expect, it } from 'vitest';
import { centsToDecimal, parseDecimalToCents, RealEbay, mapEbayOrder } from '../src/index.js';
import { baseCfg, fakeFetch, fresh, memoryStore } from './ebayFakes.js';

describe('money parsing', () => {
  it('parses decimal strings exactly with half-up rounding past two digits', () => {
    expect(parseDecimalToCents('12.34')).toBe(1234);
    expect(parseDecimalToCents('5')).toBe(500);
    expect(parseDecimalToCents('0.1')).toBe(10);
    expect(parseDecimalToCents('1.005')).toBe(101);
    expect(parseDecimalToCents('1.004')).toBe(100);
    expect(parseDecimalToCents('19.995')).toBe(2000);
    expect(parseDecimalToCents('0.29')).toBe(29); // 0.29*100 in floats is 28.999...
    expect(parseDecimalToCents('1.15')).toBe(115);
    expect(parseDecimalToCents('-3.50')).toBe(-350);
    expect(() => parseDecimalToCents('1e3')).toThrow();
    expect(() => parseDecimalToCents('$1.00')).toThrow();
  });
  it('formats cents as decimal strings', () => {
    expect(centsToDecimal(1999)).toBe('19.99');
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(-5)).toBe('-0.05');
    expect(centsToDecimal(100)).toBe('1.00');
  });
});

describe('listNewOrders', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    orderId: '12-345', creationDate: '2026-01-01T10:00:00.000Z', orderPaymentStatus: 'PAID', orderFulfillmentStatus: 'NOT_STARTED', cancelStatus: { cancelState: 'NONE_REQUESTED' },
    buyer: { username: 'b' },
    pricingSummary: { priceSubtotal: { value: '24.99', currency: 'USD' }, deliveryCost: { value: '4.50', currency: 'USD' }, total: { value: '29.49', currency: 'USD' } },
    lineItems: [{ lineItemId: '1001', legacyItemId: '110001', quantity: 1 }],
    fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: 'Jane Doe', contactAddress: { addressLine1: '1 Main St', addressLine2: 'Apt 2', city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', countryCode: 'US' } } } }],
    ...over,
  });

  it('requests with the creationdate filter and maps to the webhook shape in cents', async () => {
    const f = fakeFetch([{ json: { total: 1, orders: [order()] } }]);
    const r = await new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: memoryStore(fresh()) }).listNewOrders(new Date('2026-01-01T00:00:00.000Z'));
    const u = new URL(f.calls[0]?.url ?? '');
    expect(u.pathname).toBe('/sell/fulfillment/v1/order');
    expect(u.searchParams.get('filter')).toBe('creationdate:[2026-01-01T00:00:00.000Z..],orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');
    expect(u.searchParams.get('limit')).toBe('200');
    expect(r.skipped).toEqual([]);
    expect(r.orders).toEqual([{
      ebayOrderId: '12-345', ebayItemId: '110001', buyerName: 'Jane Doe', salePriceCents: 2499, buyerShippingCents: 450, createdAt: '2026-01-01T10:00:00.000Z',
      shipTo: { name: 'Jane Doe', line1: '1 Main St', line2: 'Apt 2', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    }]);
  });

  it('pages until a short page', async () => {
    const full = Array.from({ length: 200 }, (_, i) => order({ orderId: `o${i}` }));
    const f = fakeFetch([{ json: { total: 201, orders: full } }, { json: { total: 201, orders: [order({ orderId: 'last' })] } }]);
    const r = await new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: memoryStore(fresh()) }).listNewOrders(new Date(0));
    expect(r.orders).toHaveLength(201);
    expect(new URL(f.calls[1]?.url ?? '').searchParams.get('offset')).toBe('200');
  });

  it('skips (never guesses) unsafe orders and applies discounts conservatively', () => {
    expect(mapEbayOrder(order({ lineItems: [{ lineItemId: '1', legacyItemId: '2', quantity: 2 }] }))).toMatchObject({ skip: expect.stringContaining('quantity') });
    expect(mapEbayOrder(order({ lineItems: [{ lineItemId: '1', legacyItemId: '2' }, { lineItemId: '3', legacyItemId: '4' }] }))).toMatchObject({ skip: expect.stringContaining('line items') });
    expect(mapEbayOrder(order({ orderPaymentStatus: 'PENDING' }))).toMatchObject({ skip: expect.stringContaining('payment') });
    expect(mapEbayOrder(order({ cancelStatus: { cancelState: 'CANCELED' } }))).toMatchObject({ skip: expect.stringContaining('cancel') });
    expect(mapEbayOrder(order({ fulfillmentStartInstructions: [] }))).toMatchObject({ skip: expect.stringContaining('address') });
    expect(mapEbayOrder(order({ pricingSummary: { priceSubtotal: { value: '10.00', currency: 'EUR' } } }))).toMatchObject({ skip: expect.stringContaining('EUR') });
    const disc = mapEbayOrder(order({ pricingSummary: { priceSubtotal: { value: '25.00', currency: 'USD' }, priceDiscountSubtotal: { value: '-2.505', currency: 'USD' }, deliveryCost: { value: '5.00' }, deliveryDiscount: { value: '5.00' } } }));
    expect(disc).toMatchObject({ order: { salePriceCents: 2249, buyerShippingCents: 0 } }); // 2500 - 251 (half up); positive discount value still reduces
  });
});
