import { parseDecimalToCents } from '../../money.js';
import type { Cents } from '../../types.js';
import type { StockAndPrice, SupplierProduct, TrackingInfo } from '../types.js';

/**
 * Response-shape mapping for AliExpress DS responses -> Floor types.
 *
 * Money: AliExpress returns prices as decimal strings (sometimes with a currency alongside). We convert with
 * parseDecimalToCents (no float math) and refuse a non-USD currency so margin stays honest. All fields here are
 * ASSUMED shapes from the documented SDK/response envelopes; see the VERIFIED/ASSUMED list in docs/CONTRACT.md.
 */

/** A decimal amount string in a known currency -> integer cents (USD only). */
export function amountToCents(value: string | number | undefined, currency: string | undefined, label: string): Cents {
  if (value === undefined || value === null || value === '') return 0;
  if (currency && currency.toUpperCase() !== 'USD') {
    throw new Error(`${label} is in ${currency}, Floor is USD-only (set AliExpress currency to USD)`);
  }
  return parseDecimalToCents(String(value));
}

// --- aliexpress.ds.product.get -----------------------------------------------------------------------------------
// ASSUMED: result under aliexpress_ds_product_get_response.result; price in ae_item_sku_info_dtos / base info.
interface AeSku {
  sku_id?: string | number;
  sku_attr?: string;
  id?: string | number;
  sku_code?: string;
  offer_sale_price?: string;
  offer_bulk_sale_price?: string;
  sku_price?: string;
  sku_stock?: boolean;
  ipm_sku_stock?: number;
  currency_code?: string;
}
export interface AeProductResult {
  ae_item_base_info_dto?: {
    product_id?: string | number;
    subject?: string;
    detail?: string;
    currency_code?: string;
    category_id?: string | number;
  };
  ae_item_sku_info_dtos?: { ae_item_sku_info_d_t_o?: AeSku[] };
  ae_multimedia_info_dto?: { image_urls?: string };
  logistics_info_dto?: { delivery_time?: number; ship_to_country?: string };
  package_info_dto?: { package_type?: boolean };
  product_id_converter_result?: unknown;
}

/** Pick the SKU matching `sku_attr`, else the first SKU. */
export function pickSku(skus: readonly AeSku[], skuAttr?: string): AeSku | undefined {
  if (skuAttr) {
    const hit = skus.find((s) => s.sku_attr === skuAttr || String(s.sku_id) === skuAttr || s.sku_code === skuAttr);
    if (hit) return hit;
  }
  return skus[0];
}

function skuCents(sku: AeSku | undefined, currency: string | undefined): Cents {
  const raw = sku?.offer_sale_price ?? sku?.sku_price ?? sku?.offer_bulk_sale_price;
  return amountToCents(raw, sku?.currency_code ?? currency, 'product price');
}

function skuStock(sku: AeSku | undefined): number {
  if (typeof sku?.ipm_sku_stock === 'number') return Math.max(0, Math.floor(sku.ipm_sku_stock));
  if (sku?.sku_stock === false) return 0;
  return sku?.sku_stock === true ? 1 : 0; // ASSUMED: boolean stock flag -> at least 1 when true
}

/** images field is a semicolon-separated string in the DS product response. ASSUMED. */
export function splitImages(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(';').map((s) => s.trim()).filter((s) => s !== '');
}

export function mapProduct(
  result: AeProductResult | undefined,
  requestedSku: string,
  opts: { handlingDays: number; warehouseCountry: string; shippingCents: Cents },
): SupplierProduct | null {
  const base = result?.ae_item_base_info_dto;
  if (!result || !base?.product_id) return null;
  const skus = result.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? [];
  const sku = pickSku(skus, requestedSku.includes(':') ? requestedSku.split(':').slice(1).join(':') : undefined);
  const currency = base.currency_code;
  return {
    supplier: 'aliexpress',
    supplierSku: requestedSku,
    title: base.subject ?? `AliExpress product ${String(base.product_id)}`,
    description: base.detail ?? '',
    images: splitImages(result.ae_multimedia_info_dto?.image_urls),
    costCents: skuCents(sku, currency),
    shippingCents: opts.shippingCents,
    stock: skuStock(sku),
    warehouseCountry: result.logistics_info_dto?.ship_to_country ?? opts.warehouseCountry,
    handlingDays: opts.handlingDays,
    ...(base.category_id ? { categoryHint: String(base.category_id) } : {}),
  };
}

export function stockAndPrice(result: AeProductResult | undefined, requestedSku: string, shippingCents: Cents): StockAndPrice {
  const base = result?.ae_item_base_info_dto;
  const skus = result?.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? [];
  const sku = pickSku(skus, requestedSku.includes(':') ? requestedSku.split(':').slice(1).join(':') : undefined);
  return {
    supplierSku: requestedSku,
    costCents: skuCents(sku, base?.currency_code),
    shippingCents,
    stock: skuStock(sku),
  };
}

// --- aliexpress.logistics.buyer.freight.calculate ----------------------------------------------------------------
// ASSUMED: result.aeop_freight_calculate_result_for_buyer_d_t_o_list[].freight.amount (cheapest wins).
interface AeFreightOption {
  freight?: { amount?: string; cent?: number; currency_code?: string };
  estimated_delivery_time?: string;
  service_name?: string;
}
export interface AeFreightResult {
  aeop_freight_calculate_result_for_buyer_d_t_o_list?: { aeop_freight_calculate_result_for_buyer_dto?: AeFreightOption[] };
}

/** Cheapest freight option in cents, 0 when none offered. Prefers the integer `cent` field, else the decimal amount. */
export function cheapestFreightCents(result: AeFreightResult | undefined): Cents {
  const list = result?.aeop_freight_calculate_result_for_buyer_d_t_o_list?.aeop_freight_calculate_result_for_buyer_dto ?? [];
  let best: Cents | null = null;
  for (const o of list) {
    let c: Cents;
    if (typeof o.freight?.cent === 'number') c = Math.max(0, Math.round(o.freight.cent));
    else c = amountToCents(o.freight?.amount, o.freight?.currency_code, 'freight');
    if (best === null || c < best) best = c;
  }
  return best ?? 0;
}

// --- aliexpress.trade.buy.placeorder -----------------------------------------------------------------------------
// ASSUMED: result.order_list.number[] holds the created order id(s); is_success / error_code flag failure.
export interface AePlaceOrderResult {
  is_success?: boolean;
  error_code?: string;
  error_msg?: string;
  order_list?: { number?: (string | number)[] };
}

export function firstOrderId(result: AePlaceOrderResult | undefined): string | null {
  const n = result?.order_list?.number?.[0];
  return n === undefined || n === null ? null : String(n);
}

// --- aliexpress.ds.trade.order.get -------------------------------------------------------------------------------
// ASSUMED: result.logistics_info_list / result.order_status. Tracking appears once shipped.
interface AeLogisticsRow {
  logistics_no?: string;
  logistics_service?: string;
  logistics_service_name?: string;
  gmt_ship?: string;
}
export interface AeOrderDetailResult {
  order_status?: string;
  gmt_ship?: string;
  logistics_info_list?: { ae_order_logistics_info?: AeLogisticsRow[] };
  logistics_status?: string;
}

// --- aliexpress.logistics.ds.trackinginfo.query ------------------------------------------------------------------
// ASSUMED: result.details / official_website; or a flat tracking number + carrier.
export interface AeTrackingResult {
  result_success?: boolean;
  tracking_number?: string;
  carrier_code?: string;
  official_website?: string;
  details?: { package_tracking_detail?: { tracking_number?: string; carrier?: string }[] };
}

/**
 * Build TrackingInfo from the order-detail row (preferred: carries the gmt_ship time) and/or the tracking query.
 * Returns null until a tracking number exists (not yet shipped).
 */
export function mapTracking(
  supplierOrderId: string,
  detail: AeOrderDetailResult | undefined,
  tracking: AeTrackingResult | undefined,
  now: Date,
): TrackingInfo | null {
  const row = detail?.logistics_info_list?.ae_order_logistics_info?.[0];
  const number = row?.logistics_no ?? tracking?.tracking_number ?? tracking?.details?.package_tracking_detail?.[0]?.tracking_number;
  if (!number) return null;
  const carrier =
    row?.logistics_service_name ?? row?.logistics_service ?? tracking?.carrier_code ?? tracking?.details?.package_tracking_detail?.[0]?.carrier ?? 'AliExpress Standard';
  const shippedAt = row?.gmt_ship ?? detail?.gmt_ship;
  return {
    supplierOrderId,
    trackingNumber: number,
    carrier,
    shippedAt: shippedAt ? new Date(shippedAt).toISOString() : now.toISOString(),
  };
}
