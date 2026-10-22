import type { Cents, Pct, Product } from './types';

// Manual supplier (CONTRACT.md → Manual supplier v1.3)
export interface ManualSupplierRef { kind: 'manual'; url?: string; title: string; supplierSku: string }

export interface ManualProductInput {
  title: string;
  description: string;
  images: string[];
  costCents: Cents;
  shippingCents: Cents;
  stock: number;
  handlingDays: number;
  warehouseCountry: string;
  supplierUrl?: string;
  brand?: string;
  categoryHint?: string;
}
/** PATCH body: any subset. `null` clears an optional field (contract v1.3 clarification). */
export type ManualProductPatch = Partial<Omit<ManualProductInput, 'supplierUrl' | 'brand' | 'categoryHint'>> & {
  supplierUrl?: string | null;
  brand?: string | null;
  categoryHint?: string | null;
};
export interface ManualProductsResponse { items: Product[]; total: number }

export interface SupplierQuote {
  netProfitCents: Cents;
  netMarginPct: Pct;
  ebayFeesCents: Cents;
  maxSupplierCostCents: Cents;
  meetsFloor: boolean;
}
export interface SupplierOrderInput {
  supplierOrderId: string;
  costCents: Cents;
  shippingCents: Cents;
  confirmBelowFloor?: boolean;
}
/** `error.details` of 422 BELOW_FLOOR on POST /orders/:id/supplier-order. */
export interface BelowFloorDetails { maxSupplierCostCents: Cents; netMarginPct: Pct; netProfitCents: Cents }
