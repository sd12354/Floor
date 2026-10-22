// Types copied from docs/CONTRACT.md. Names are kept identical to the contract.

export type Cents = number;
export type Pct = number;

export interface FeeConfig {
  finalValueFeePct: Pct;
  perOrderFeeCents: Cents;
  promotedPct: Pct;
  storeDiscountPct: Pct;
  topRatedDiscountPct: Pct;
  belowStandardSurchargePct: Pct;
}

export interface MarginInput {
  salePriceCents: Cents;
  buyerShippingCents: Cents;
  supplierCostCents: Cents;
  supplierShippingCents: Cents;
  toolFeeCents: Cents;
  fees: FeeConfig;
}

export interface MarginResult {
  ebayFeesCents: Cents;
  netProfitCents: Cents;
  netMarginPct: Pct;
}

export interface PricingRule {
  floorPct: Pct;
  targetPct: Pct;
  roundTo: 'none' | '0.99' | '0.95';
}

export type LadderDecision =
  | { action: 'fulfil'; reason: 'within_tolerance' | 'small_loss' }
  | { action: 'hold'; reason: 'below_floor'; deadline: string }
  | { action: 'cancel'; reason: 'no_decision' | 'out_of_stock' };

export type ComplianceCode =
  | 'SUPPLIER_NOT_ALLOWED'
  | 'VERO_MATCH'
  | 'RESTRICTED_CATEGORY'
  | 'NO_IMAGES'
  | 'HANDLING_TIME_EXCEEDED';

export type ComplianceResult = { ok: true } | { ok: false; code: ComplianceCode; detail: string };

export type SupplierKind = 'mock' | 'cjdropshipping' | 'spocket';

export interface SupplierConnection {
  id: string;
  accountId: string;
  supplier: SupplierKind;
  status: 'connected' | 'error' | 'not_configured';
  label: string;
  createdAt: string;
}

export interface Account {
  id: string;
  name: string;
  /** v1.1: which connector set the API is running with. */
  mode: 'mock' | 'real';
  ebayConnected: boolean;
  ebayUsername?: string;
  pricingRule: PricingRule;
  fees: FeeConfig;
  dailySpendCapCents: Cents;
  smallLossToleranceCents: Cents;
  handlingTimeDays: number;
  /** v1.1: new-seller accounts have a +30 day payout hold. */
  newSeller: boolean;
  createdAt: string;
  supplierConnections: SupplierConnection[];
}

export type AccountPatch = Partial<
  Pick<Account, 'name' | 'dailySpendCapCents' | 'smallLossToleranceCents' | 'handlingTimeDays' | 'newSeller'> & {
    pricingRule: Partial<PricingRule>;
    fees: Partial<FeeConfig>;
  }
>;

export interface Product {
  id: string;
  supplier: SupplierKind;
  supplierSku: string;
  title: string;
  description: string;
  images: string[];
  costCents: Cents;
  shippingCents: Cents;
  stock: number;
  warehouseCountry: string;
  /** v1.1: supplier handling time in days (compliance gate input). */
  handlingDays: number;
  brand?: string;
  categoryHint?: string;
  updatedAt: string;
}

export type ListingStatus = 'draft' | 'active' | 'paused' | 'ended' | 'blocked';

export interface Listing {
  id: string;
  accountId: string;
  productId: string;
  ebayItemId?: string;
  title: string;
  /** v1.1 */
  description: string;
  priceCents: Cents;
  /** v1.1: minimum price that still clears the account floor; recomputed on every sync. */
  floorPriceCents: Cents;
  buyerShippingCents: Cents;
  quantity: number;
  status: ListingStatus;
  pauseReason?: string;
  projectedMarginPct: Pct;
  /** null until the first sync/publish. */
  lastSyncAt: string | null;
  createdAt: string;
}

export interface Address {
  name?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export type OrderStatus =
  | 'paid'
  | 'checking'
  | 'held'
  | 'queued'
  | 'ordered'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export interface Order {
  id: string;
  accountId: string;
  listingId: string;
  ebayOrderId: string;
  buyerName: string;
  shipTo: Address;
  salePriceCents: Cents;
  buyerShippingCents: Cents;
  status: OrderStatus;
  supplierOrderId?: string;
  supplierCostCents?: Cents;
  supplierShippingCents?: Cents;
  /** v1.1: computed at `checking`, finalised at `ordered`. */
  ebayFeesCents?: Cents;
  trackingNumber?: string;
  carrier?: string;
  ladderDecision?: LadderDecision;
  holdDeadline?: string;
  payoutExpectedAt?: string;
  paidOutAt?: string;
  deliveredAt?: string;
  netProfitCents?: Cents;
  createdAt: string;
  updatedAt: string;
}

export type LedgerKind = 'sale' | 'ebay_fee' | 'supplier_cost' | 'supplier_shipping' | 'refund' | 'payout';

export interface LedgerEntry {
  id: string;
  accountId: string;
  orderId?: string;
  kind: LedgerKind;
  amountCents: Cents;
  at: string;
}

export interface Event {
  id: string;
  accountId: string;
  orderId?: string;
  listingId?: string;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export type MessageKind = 'order_confirmed' | 'shipped' | 'delivered' | 'wismo' | 'cancel' | 'return' | 'other';

export interface Message {
  id: string;
  accountId: string;
  orderId: string;
  direction: 'in' | 'out';
  kind: MessageKind;
  body: string;
  suggestedReply?: string;
  /** v1.1: outbound always true; inbound flips once a reply exists. */
  answered: boolean;
  at: string;
}

// Endpoint response shapes

export type DiscoveryItem = Product & {
  projectedPriceCents: Cents;
  projectedMarginPct: Pct;
  compliance: ComplianceResult;
};
export interface Paged { page: number; pageSize: number }
export interface DiscoveryResponse extends Paged { items: DiscoveryItem[]; total: number }

export type ListingWithProduct = Listing & { product: Product };
export interface ListingsResponse extends Paged { items: ListingWithProduct[]; total: number }
export interface CreateListingsResponse {
  created: Listing[];
  blocked: { productId: string; compliance: ComplianceResult }[];
}
export interface PublishListingsResponse {
  published: Listing[];
  blocked: { id: string; compliance: ComplianceResult }[];
}
export interface SyncResponse { repriced: number; paused: number; resumed: number; checked: number; blocked: number }

export type OrderRow = Order & { listing: { title: string } };
export interface OrdersResponse extends Paged { items: OrderRow[]; total: number }
export type OrderDetail = Order & { listing: { title: string }; events: Event[]; messages: Message[]; ledger: LedgerEntry[] };

export interface FloatRow {
  orderId: string;
  listingTitle: string;
  amountCents: Cents;
  /** null while the order is still ordered/shipped (payout date is set on delivery). */
  payoutExpectedAt: string | null;
  status: OrderStatus;
}

export interface DashboardResponse {
  float: { outstandingCents: Cents; byOrder: FloatRow[] };
  today: { orders: number; revenueCents: Cents; profitCents: Cents; supplierSpendCents: Cents; spendCapCents: Cents };
  health: {
    lateShipmentPct: Pct;
    defectPct: Pct;
    casesOpen: number;
    thresholds: { lateShipmentPct: Pct; defectPct: Pct };
  };
  listings: { active: number; paused: number; draft: number; blocked: number; ended: number };
  recentEvents: Event[];
}

export interface LedgerResponse {
  entries: LedgerEntry[];
  totals: { revenueCents: Cents; feesCents: Cents; costCents: Cents; profitCents: Cents; payoutCents: Cents };
}

export interface ApiError { error: { code: string; message: string; details?: unknown } }

// Auth (CONTRACT.md → Auth)
export interface AuthUser { id: string; email: string }
export interface AuthSession { token: string; expiresAt: string; user: AuthUser }
export interface AuthStatus { hasUsers: boolean }
