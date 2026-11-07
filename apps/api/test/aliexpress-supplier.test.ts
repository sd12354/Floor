import { NotConfiguredError } from '@floor/core';
import { afterEach, describe, expect, it } from 'vitest';
import { intakeOrder, processOrder } from '../src/services/orderPipeline.js';
import { authed, createRealTestApp, type RealTestApp, type Responder } from './realHelpers.js';

let t: RealTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const GATEWAY = 'https://api-sg.aliexpress.com/sync';
/** Which TOP method a recorded gateway POST carries (form-urlencoded body). */
function method(body: string | undefined): string {
  return new URLSearchParams(body ?? '').get('method') ?? '';
}

/** Fake AliExpress gateway: answers each DS method by its `method` param. */
const aliexpress = (over: { price?: string; stock?: number } = {}): Responder => (r) => {
  if (!r.url.startsWith(GATEWAY)) return undefined;
  const m = method(r.body);
  if (m === 'aliexpress.ds.product.get') {
    return {
      json: {
        aliexpress_ds_product_get_response: {
          result: {
            ae_item_base_info_dto: { product_id: '4000999', subject: 'Widget', detail: 'd', currency_code: 'USD', category_id: '200' },
            ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: [{ sku_attr: '14:29', offer_sale_price: over.price ?? '12.00', currency_code: 'USD', ipm_sku_stock: over.stock ?? 9 }] },
            ae_multimedia_info_dto: { image_urls: 'https://i/a.jpg' },
            logistics_info_dto: { ship_to_country: 'US' },
          },
        },
      },
    };
  }
  if (m === 'aliexpress.logistics.buyer.freight.calculate') {
    return { json: { aliexpress_logistics_buyer_freight_calculate_response: { result: { aeop_freight_calculate_result_for_buyer_d_t_o_list: { aeop_freight_calculate_result_for_buyer_dto: [{ freight: { amount: '0.00', currency_code: 'USD' } }] } } } } };
  }
  if (m === 'aliexpress.trade.buy.placeorder') {
    return { json: { aliexpress_trade_buy_placeorder_response: { result: { is_success: true, order_list: { number: [80012345] } } } } };
  }
  if (m === 'aliexpress.trade.ds.order.get') {
    return { json: { aliexpress_trade_ds_order_get_response: { result: { order_status: 'PLACE_ORDER_SUCCESS', product_list: { ae_order_item: [{ product_unit_price: '12.00', product_count: 1, currency_code: 'USD' }] } } } } };
  }
  return undefined;
};

type AliCreds = { aliexpress: { appKey?: string; appSecret?: string; accessToken?: string } };
const aliexpressCreds: AliCreds = { aliexpress: { appKey: 'ak', appSecret: 'as', accessToken: 'tok' } };

/** A connected seller with one active AliExpress listing priced to clear the floor. */
async function setup(responders: Responder[], creds: AliCreds = aliexpressCreds): Promise<RealTestApp> {
  const x = await createRealTestApp({ responders, config: creds });
  await x.db.product.create({ data: { id: 'prd_ae', supplier: 'aliexpress', supplierSku: '4000999:14:29', title: 'Widget', description: 'd', images: ['https://i/a.jpg'], costCents: 1200, shippingCents: 0, stock: 9, warehouseCountry: 'CN', handlingDays: 3 } });
  await x.db.listing.create({ data: { id: 'lst_ae', accountId: 'acc_demo', productId: 'prd_ae', ebayItemId: '110001', title: 'Widget', priceCents: 3000, floorPriceCents: 2000, status: 'active', projectedMarginPct: 0.4 } });
  return x;
}

const account = (x: RealTestApp) => x.db.account.findUniqueOrThrow({ where: { id: 'acc_demo' } });
const shipTo = { name: 'Jane Buyer', line1: '1 Market St', city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'US' };

describe('RealAliExpress wired into the API', () => {
  it('places and pays an AliExpress order through the pipeline, storing the supplier order id', async () => {
    t = await setup([aliexpress()]);
    const { order } = await intakeOrder(t.db, await account(t), { ebayOrderId: 'ebay-1', listingId: 'lst_ae', buyerName: 'Jane Buyer', shipTo, salePriceCents: 3000, buyerShippingCents: 0 });
    const result = await processOrder(t.db, t.connectors, await account(t), order.id);
    expect(result).toMatchObject({ status: 'ordered', supplierOrderId: '80012345', supplierCostCents: 1200, supplierShippingCents: 0 });

    // The gateway saw exactly one placeorder, and the ledger booked the supplier cost.
    const placeorders = t.ebay.calls.filter((c) => method(c.body) === 'aliexpress.trade.buy.placeorder');
    expect(placeorders).toHaveLength(1);
    const ledger = await t.db.ledgerEntry.findMany({ where: { orderId: order.id } });
    expect(ledger.find((e) => e.kind === 'supplier_cost')?.amountCents).toBe(-1200);
  });

  it('is idempotent: re-processing the same eBay order never places a second AliExpress order', async () => {
    t = await setup([aliexpress()]);
    const { order } = await intakeOrder(t.db, await account(t), { ebayOrderId: 'ebay-1', listingId: 'lst_ae', buyerName: 'Jane Buyer', shipTo, salePriceCents: 3000, buyerShippingCents: 0 });
    await processOrder(t.db, t.connectors, await account(t), order.id);
    // A re-run of the pipeline on an already-ordered order places nothing new (pipeline + connector both guard).
    const second = await processOrder(t.db, t.connectors, await account(t), order.id);
    expect(second.status).toBe('ordered');
    expect(t.ebay.calls.filter((c) => method(c.body) === 'aliexpress.trade.buy.placeorder')).toHaveLength(1);
    expect(await t.db.order.count()).toBe(1);
  });

  it('throws NotConfiguredError when AliExpress credentials are missing (no request made)', async () => {
    t = await setup([aliexpress()], { aliexpress: {} });
    const supplier = t.connectors.supplier('aliexpress');
    const before = t.ebay.calls.length;
    await expect(supplier.getStockAndPrice(['4000999'])).rejects.toBeInstanceOf(NotConfiguredError);
    expect(t.ebay.calls.length).toBe(before);
  });

  it('POST /suppliers connects AliExpress in real mode', async () => {
    t = await setup([aliexpress()]);
    const res = await t.api<{ supplier: string; status: string; label: string }>('POST', '/suppliers', { supplier: 'aliexpress' }, authed(t));
    expect(res.status).toBe(201);
    expect(res.body.supplier).toBe('aliexpress');
    expect(res.body.label).toBe('AliExpress');
  });
});
