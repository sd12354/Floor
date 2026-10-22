import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { setToken } from '@/lib/authToken';
import { api } from './client';
import type {
  Account,
  AccountPatch,
  AuthSession,
  AuthStatus,
  AuthUser,
  CreateListingsResponse,
  DashboardResponse,
  DiscoveryItem,
  DiscoveryResponse,
  EbaySetupInput,
  EbaySetupResponse,
  LedgerResponse,
  Listing,
  ManualProductInput,
  ManualProductPatch,
  ManualProductsResponse,
  Product,
  ListingsResponse,
  Message,
  Order,
  OrderDetail,
  OrdersResponse,
  PublishListingsResponse,
  SupplierOrderInput,
  SupplierQuote,
  SupplierConnection,
  SupplierKind,
  SyncResponse,
} from './types';

export const keys = {
  authStatus: ['auth', 'status'] as const,
  me: ['auth', 'me'] as const,
  account: ['account'] as const,
  dashboard: ['dashboard'] as const,
  discovery: (q: object) => ['discovery', q] as const,
  listings: (q: object) => ['listings', q] as const,
  orders: (q: object) => ['orders', q] as const,
  order: (id: string) => ['order', id] as const,
  ledger: (q: object) => ['ledger', q] as const,
  messages: (q: object) => ['messages', q] as const,
  manualProducts: ['manual-products'] as const,
  supplierQuote: (id: string, costCents: number, shippingCents: number) => ['supplier-quote', id, costCents, shippingCents] as const,
};

function useInvalidate() {
  const qc = useQueryClient();
  return (...roots: string[]) => Promise.all(roots.map((r) => qc.invalidateQueries({ queryKey: [r] })));
}

// Account & setup
export const useAccount = () => useQuery({ queryKey: keys.account, queryFn: () => api.get<Account>('/account') });

export function usePatchAccount() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (patch: AccountPatch) => api.patch<Account>('/account', patch),
    onSuccess: () => inv('account', 'dashboard', 'discovery', 'listings'),
  });
}

export function useConnectEbay() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api.post<Account | { authorizeUrl: string }>('/account/ebay/connect'),
    onSuccess: () => inv('account'),
  });
}

export const useEbaySetup = () =>
  useMutation({ mutationFn: (body: EbaySetupInput) => api.post<EbaySetupResponse>('/account/ebay/setup', body) });

export function useAddSupplier() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { supplier: SupplierKind; credentials?: Record<string, string> }) =>
      api.post<SupplierConnection>('/suppliers', body),
    onSuccess: () => inv('account', 'discovery'),
  });
}

export function useRemoveSupplier() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/suppliers/${id}`),
    onSuccess: () => inv('account', 'discovery'),
  });
}

// Discovery
export interface DiscoveryQuery { supplier?: string; q?: string; minMarginPct?: number; page?: number; pageSize?: number }
export const useDiscovery = (q: DiscoveryQuery) =>
  useQuery({ queryKey: keys.discovery(q), queryFn: () => api.get<DiscoveryResponse>('/discovery', { ...q }) });
export const useDiscoveryItem = (id: string) =>
  useQuery({ queryKey: ['discovery', 'item', id], queryFn: () => api.get<DiscoveryItem>(`/discovery/${id}`) });

// Listings
export interface ListingsQuery { status?: string; q?: string; page?: number; pageSize?: number }
export const useListings = (q: ListingsQuery) =>
  useQuery({ queryKey: keys.listings(q), queryFn: () => api.get<ListingsResponse>('/listings', { ...q }) });

export function useCreateListings() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (productIds: string[]) => api.post<CreateListingsResponse>('/listings', { productIds }),
    onSuccess: () => inv('listings', 'dashboard'),
  });
}

export function usePatchListing() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; title?: string; priceCents?: number; status?: 'active' | 'paused' }) =>
      api.patch<Listing>(`/listings/${id}`, patch),
    onSuccess: () => inv('listings', 'dashboard'),
  });
}

export function usePublishListings() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<PublishListingsResponse>('/listings/publish', { ids }),
    onSuccess: () => inv('listings', 'dashboard'),
  });
}

export function useSyncListings() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: () => api.post<SyncResponse>('/listings/sync'),
    onSuccess: () => inv('listings', 'dashboard'),
  });
}

// Orders
export interface OrdersQuery { status?: string; page?: number; pageSize?: number }
export const useOrders = (q: OrdersQuery) =>
  useQuery({ queryKey: keys.orders(q), queryFn: () => api.get<OrdersResponse>('/orders', { ...q }) });
export const useOrder = (id: string) =>
  useQuery({ queryKey: keys.order(id), queryFn: () => api.get<OrderDetail>(`/orders/${id}`) });

export function useOrderDecision() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'fulfil' | 'cancel' }) =>
      api.post<Order>(`/orders/${id}/decision`, { action }),
    onSuccess: () => inv('orders', 'order', 'dashboard', 'ledger'),
  });
}

export function useSimulateSale() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: { listingId: string; buyerName?: string; priceDriftPct?: number }) =>
      api.post<Order>('/orders/simulate', body),
    onSuccess: () => inv('orders', 'dashboard', 'ledger', 'listings', 'messages'),
  });
}

// Manual supplier (v1.3)
export const useManualProducts = () =>
  useQuery({ queryKey: keys.manualProducts, queryFn: () => api.get<ManualProductsResponse>('/manual-products') });

export function useCreateManualProduct() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (body: ManualProductInput) => api.post<Product>('/manual-products', body),
    onSuccess: () => inv('manual-products', 'discovery'),
  });
}

export function usePatchManualProduct() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & ManualProductPatch) => api.patch<Product>(`/manual-products/${id}`, patch),
    // A cost, shipping or stock change reprices or pauses the product's listings on the server.
    onSuccess: () => inv('manual-products', 'discovery', 'listings', 'dashboard'),
  });
}

export function useDeleteManualProduct() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/manual-products/${id}`),
    onSuccess: () => inv('manual-products', 'discovery', 'listings'),
  });
}

/**
 * What-if margin for the numbers the seller was quoted. Read-only (POST, but no state change), so it is a query keyed by the
 * amounts: a slow answer for old numbers can never overwrite the answer for new ones. Pass null to switch it off.
 */
export function useSupplierQuote(orderId: string, amounts: { costCents: number; shippingCents: number } | null) {
  return useQuery({
    queryKey: keys.supplierQuote(orderId, amounts?.costCents ?? -1, amounts?.shippingCents ?? -1),
    queryFn: () => api.post<SupplierQuote>(`/orders/${orderId}/supplier-quote`, amounts),
    enabled: amounts !== null,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    gcTime: 30_000,
  });
}

const ORDER_ROOTS = ['orders', 'order', 'dashboard', 'ledger', 'messages'] as const;

export function useRecordSupplierOrder() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & SupplierOrderInput) => api.post<Order>(`/orders/${id}/supplier-order`, body),
    onSuccess: () => inv(...ORDER_ROOTS),
  });
}

export function useAddTracking() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; trackingNumber: string; carrier: string }) => api.post<Order>(`/orders/${id}/tracking`, body),
    onSuccess: () => inv(...ORDER_ROOTS),
  });
}

export function useMarkDelivered() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.post<Order>(`/orders/${id}/delivered`),
    onSuccess: () => inv(...ORDER_ROOTS),
  });
}

// Dashboard & ledger
export const useDashboard = () =>
  useQuery({ queryKey: keys.dashboard, queryFn: () => api.get<DashboardResponse>('/dashboard'), refetchInterval: 15_000 });

export const useLedger = (q: { from?: string; to?: string }) =>
  useQuery({ queryKey: keys.ledger(q), queryFn: () => api.get<LedgerResponse>('/ledger', { ...q }) });

// Messages
export const useMessages = (q: { orderId?: string; unansweredOnly?: boolean }) =>
  useQuery({ queryKey: keys.messages(q), queryFn: () => api.get<Message[]>('/messages', { ...q }) });

export function useReplyMessage() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.post<Message>(`/messages/${id}/reply`, { body }),
    onSuccess: () => inv('messages', 'order'),
  });
}

// Auth
export const useAuthStatus = () => useQuery({ queryKey: keys.authStatus, queryFn: () => api.get<AuthStatus>('/auth/status'), retry: false, staleTime: 0 });
export const useMe = (enabled = true) =>
  useQuery({ queryKey: keys.me, queryFn: async () => (await api.get<{ user: AuthUser }>('/auth/me')).user, enabled, retry: false });

/** Signs in (or creates the first account) and stores the token. Clears cached data from any previous session. */
export function useSignIn(mode: 'signin' | 'signup') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<AuthSession>(mode === 'signup' ? '/auth/signup' : '/auth/login', body),
    onSuccess: (session) => {
      qc.clear();
      setToken(session.token);
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout').catch(() => undefined),
    onSettled: () => {
      setToken(null);
      qc.clear();
    },
  });
}
