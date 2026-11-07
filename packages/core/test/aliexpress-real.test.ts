import { describe, expect, it } from 'vitest';
import {
  AliExpressReauthRequiredError,
  NotConfiguredError,
  RealAliExpress,
  signTopRequest,
} from '../src/index.js';
import { NOW, baseCfg, fakeFetch, formParams, memoryOrderRefStore, shipTo } from './aliexpressFakes.js';

const GATEWAY = 'https://api-sg.aliexpress.com/sync';

/** A product.get reply with one SKU at $12.34 and stock 7. */
function productReply(price = '12.34', stock = 7) {
  return {
    json: {
      aliexpress_ds_product_get_response: {
        result: {
          ae_item_base_info_dto: { product_id: '4000999', subject: 'Widget', detail: 'A widget', currency_code: 'USD', category_id: '200' },
          ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: [{ sku_attr: '14:29', offer_sale_price: price, currency_code: 'USD', ipm_sku_stock: stock }] },
          ae_multimedia_info_dto: { image_urls: 'https://i/a.jpg;https://i/b.jpg' },
          logistics_info_dto: { ship_to_country: 'US' },
        },
      },
    },
  };
}
/** A freight reply offering $2.50 and $3.10; cheapest is 250 cents. */
const freightReply = {
  json: {
    aliexpress_logistics_buyer_freight_calculate_response: {
      result: {
        aeop_freight_calculate_result_for_buyer_d_t_o_list: {
          aeop_freight_calculate_result_for_buyer_dto: [
            { freight: { amount: '3.10', currency_code: 'USD' }, service_name: 'STD' },
            { freight: { amount: '2.50', currency_code: 'USD' }, service_name: 'ECON' },
          ],
        },
      },
    },
  },
};

describe('RealAliExpress configuration', () => {
  it('throws NotConfiguredError naming every missing credential, with no request', async () => {
    const f = fakeFetch([]);
    const ae = new RealAliExpress({ fetch: f.fetch, orderRefStore: memoryOrderRefStore() });
    const err = await ae.getProduct('4000999').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotConfiguredError);
    expect((err as NotConfiguredError).missing).toEqual(['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET', 'ALIEXPRESS_ACCESS_TOKEN']);
    expect(f.calls).toHaveLength(0);
  });

  it('exposes supplier "aliexpress"', () => {
    expect(new RealAliExpress(baseCfg).supplier).toBe('aliexpress');
  });
});

describe('RealAliExpress signing and request shape', () => {
  it('every gateway call is a signed form POST with the system params and a valid HMAC signature', async () => {
    const f = fakeFetch([productReply(), freightReply]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch });
    await ae.getProduct('4000999');
    const c = f.calls[0];
    expect(c?.url).toBe(GATEWAY);
    expect(c?.method).toBe('POST');
    expect(c?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const p = formParams(c);
    expect(p.method).toBe('aliexpress.ds.product.get');
    expect(p.app_key).toBe('app_key_1');
    expect(p.session).toBe('tok');
    expect(p.format).toBe('json');
    expect(p.v).toBe('2.0');
    expect(p.sign_method).toBe('sha256');
    expect(p.timestamp).toBe(String(NOW.getTime()));
    expect(p.product_id).toBe('4000999');
    // The signature in the body matches a fresh signature over the other params.
    const { sign, ...rest } = p;
    expect(sign).toBe(signTopRequest(rest, 'secret123'));
  });
});

describe('RealAliExpress getStockAndPrice money -> cents', () => {
  it('maps the SKU price exactly to cents (no float) and adds cheapest freight', async () => {
    const f = fakeFetch([productReply('12.34', 7), freightReply]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch });
    const [row] = await ae.getStockAndPrice(['4000999:14:29']);
    expect(row).toEqual({ supplierSku: '4000999:14:29', costCents: 1234, shippingCents: 250, stock: 7 });
  });

  it('a third decimal rounds half up and a non-USD currency is refused', async () => {
    const f = fakeFetch([productReply('1.005', 3), { json: {} }]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch });
    const [row] = await ae.getStockAndPrice(['4000999']);
    expect(row?.costCents).toBe(101); // 1.005 -> 101
    expect(row?.shippingCents).toBe(0); // empty freight result

    const f2 = fakeFetch([
      { json: { result: { ae_item_base_info_dto: { product_id: '1', currency_code: 'EUR' }, ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: [{ offer_sale_price: '9.99', currency_code: 'EUR' }] } } } },
      { json: {} },
    ]);
    await expect(new RealAliExpress({ ...baseCfg, fetch: f2.fetch }).getStockAndPrice(['1'])).rejects.toThrow(/USD-only/);
  });
});

describe('RealAliExpress getProduct', () => {
  it('maps base info, semicolon images and the chosen SKU to a SupplierProduct', async () => {
    const f = fakeFetch([productReply('12.34', 7), freightReply]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch });
    const prod = await ae.getProduct('4000999:14:29');
    expect(prod).toMatchObject({
      supplier: 'aliexpress',
      supplierSku: '4000999:14:29',
      title: 'Widget',
      description: 'A widget',
      images: ['https://i/a.jpg', 'https://i/b.jpg'],
      costCents: 1234,
      shippingCents: 250,
      stock: 7,
      warehouseCountry: 'US',
      categoryHint: '200',
    });
  });
});

describe('RealAliExpress placeOrder', () => {
  /** placeorder (ok) then order.get (for the paid cost). */
  const placeReplies = () => [
    { json: { aliexpress_trade_buy_placeorder_response: { result: { is_success: true, order_list: { number: [80012345] } } } } },
    { json: { aliexpress_trade_ds_order_get_response: { result: { order_status: 'PLACE_ORDER_SUCCESS', product_list: { ae_order_item: [{ product_unit_price: '12.34', product_count: 1, currency_code: 'USD' }] } } } } },
  ];

  it('places an order: correct method, signed param_place_order_request4 with address + product, returns the order id and paid cost', async () => {
    const f = fakeFetch(placeReplies());
    const store = memoryOrderRefStore();
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch, orderRefStore: store, defaultLogisticsService: 'CAINIAO_STANDARD' });
    const res = await ae.placeOrder({ idempotencyKey: 'ebay-1', supplierSku: '4000999:14:29', quantity: 1, shipTo, buyerName: 'Jane Buyer', now: NOW });
    expect(res).toEqual({ supplierOrderId: '80012345', costCents: 1234, shippingCents: 0 });

    const create = formParams(f.calls[0]);
    expect(create.method).toBe('aliexpress.trade.buy.placeorder');
    const dto = JSON.parse(create.param_place_order_request4 ?? '{}');
    expect(dto.logistics_address).toEqual({ address: '1 Market St, Apt 2', city: 'San Francisco', country: 'US', full_name: 'Jane Buyer', province: 'CA', zip: '94105' });
    expect(dto.product_items).toEqual([{ product_id: '4000999', sku_attr: '14:29', product_count: 1, logistics_service_name: 'CAINIAO_STANDARD' }]);
    expect(dto.out_order_id).toBe('ebay-1'); // buyer reference passed through
    expect(dto.ds_extend_request.out_order_id).toBe('ebay-1');
    // the create call is signed
    const { sign, ...rest } = create;
    expect(sign).toBe(signTopRequest(rest, 'secret123'));
    // the store now knows the mapping
    expect(store.map.get('ebay-1')).toBe('80012345');
  });

  it('is idempotent on idempotencyKey: a replay makes no second placeorder call and returns the same order id', async () => {
    const store = memoryOrderRefStore();
    const f1 = fakeFetch(placeReplies());
    const ae1 = new RealAliExpress({ ...baseCfg, fetch: f1.fetch, orderRefStore: store });
    const first = await ae1.placeOrder({ idempotencyKey: 'ebay-1', supplierSku: '4000999:14:29', quantity: 1, shipTo, buyerName: 'Jane Buyer', now: NOW });
    expect(f1.calls.map((c) => formParams(c).method)).toEqual(['aliexpress.trade.buy.placeorder', 'aliexpress.trade.ds.order.get']);

    // Replay: only an order.get to re-read the cost; NO second placeorder.
    const f2 = fakeFetch([{ json: { aliexpress_trade_ds_order_get_response: { result: { product_list: { ae_order_item: [{ product_unit_price: '12.34', product_count: 1, currency_code: 'USD' }] } } } } }]);
    const ae2 = new RealAliExpress({ ...baseCfg, fetch: f2.fetch, orderRefStore: store });
    const replay = await ae2.placeOrder({ idempotencyKey: 'ebay-1', supplierSku: '4000999:14:29', quantity: 1, shipTo, buyerName: 'Jane Buyer', now: NOW });
    expect(replay.supplierOrderId).toBe(first.supplierOrderId);
    expect(f2.calls.map((c) => formParams(c).method)).toEqual(['aliexpress.trade.ds.order.get']);
  });

  it('a placeorder business failure throws and records nothing', async () => {
    const store = memoryOrderRefStore();
    const f = fakeFetch([{ json: { aliexpress_trade_buy_placeorder_response: { result: { is_success: false, error_code: 'B_ERROR', error_msg: 'out of stock' } } } }]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch, orderRefStore: store });
    await expect(ae.placeOrder({ idempotencyKey: 'ebay-2', supplierSku: '4000999', quantity: 1, shipTo, buyerName: 'B', now: NOW })).rejects.toThrow(/out of stock/);
    expect(store.map.has('ebay-2')).toBe(false);
  });

  it('refuses to place an order when no OrderRefStore is configured (cannot guarantee idempotency)', async () => {
    const f = fakeFetch([]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch });
    await expect(ae.placeOrder({ idempotencyKey: 'x', supplierSku: '1', quantity: 1, shipTo, buyerName: 'B', now: NOW })).rejects.toThrow(NotConfiguredError);
    expect(f.calls).toHaveLength(0);
  });
});

describe('RealAliExpress getTracking', () => {
  it('returns null until shipped (order has no logistics row and the tracking query is empty)', async () => {
    const f = fakeFetch([
      { json: { aliexpress_trade_ds_order_get_response: { result: { order_status: 'WAIT_SELLER_SEND_GOODS', logistics_info_list: { ae_order_logistics_info: [] } } } } },
      { json: { aliexpress_logistics_ds_trackinginfo_query_response: { result: {} } } },
    ]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch });
    expect(await ae.getTracking('80012345', NOW)).toBeNull();
  });

  it('returns the tracking number and carrier once the order ships', async () => {
    const f = fakeFetch([
      { json: { aliexpress_trade_ds_order_get_response: { result: { order_status: 'WAIT_BUYER_ACCEPT_GOODS', gmt_ship: '2026-01-02 03:04:05', logistics_info_list: { ae_order_logistics_info: [{ logistics_no: 'LP123', logistics_service_name: 'Cainiao', gmt_ship: '2026-01-02 03:04:05' }] } } } } },
      { json: { aliexpress_logistics_ds_trackinginfo_query_response: { result: { tracking_number: 'LP123' } } } },
    ]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch });
    const t = await ae.getTracking('80012345', NOW);
    expect(t).toEqual({ supplierOrderId: '80012345', trackingNumber: 'LP123', carrier: 'Cainiao', shippedAt: new Date('2026-01-02 03:04:05').toISOString() });
    expect(formParams(f.calls[0]).method).toBe('aliexpress.trade.ds.order.get');
    expect(formParams(f.calls[1]).method).toBe('aliexpress.logistics.ds.trackinginfo.query');
  });
});

describe('RealAliExpress auth failure', () => {
  it('a dead-token error envelope becomes AliExpressReauthRequiredError', async () => {
    const f = fakeFetch([{ json: { code: '0', sub_code: 'InvalidAccessToken', sub_msg: 'token expired' } }]);
    const ae = new RealAliExpress({ ...baseCfg, fetch: f.fetch });
    await expect(ae.getProduct('4000999')).rejects.toThrow(AliExpressReauthRequiredError);
  });
});
