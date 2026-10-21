import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  Account,
  AccountPatch,
  CreateListingsResponse,
  DashboardResponse,
  DiscoveryItem,
  DiscoveryResponse,
  LedgerResponse,
  Listing,
  ListingsResponse,
  Message,
  Order,
  OrderDetail,
  OrdersResponse,
  PublishListingsResponse,
  SupplierConnection,
  SupplierKind,
  SyncResponse,
} from './types';

export const keys = {
  account: ['account'] as const,
  dashboard: ['dashboard'] as const,
  discovery: (q: object) => ['discovery', q] as const,
  listings: (q: object) => ['listings', q] as const,
  orders: (q: object) => ['orders', q] as const,
  order: (id: string) => ['order', id] as const,
  ledger: (q: object) => ['ledger', q] as const,
  messages: (q: object) => ['messages', q] as const,
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
