import { createBrowserRouter, createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui';
import { AppShell } from '@/components/layout/AppShell';
import { SetupGate } from '@/components/layout/SetupGate';
import { DashboardPage } from '@/pages/DashboardPage';
import { DiscoveryPage } from '@/pages/DiscoveryPage';
import { ListingsPage } from '@/pages/ListingsPage';
import { OrdersPage } from '@/pages/OrdersPage';
import { OrderDetailPage } from '@/pages/OrderDetailPage';
import { LedgerPage } from '@/pages/LedgerPage';
import { MessagesPage } from '@/pages/MessagesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const routes: RouteObject[] = [
  {
    element: <SetupGate />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/discovery', element: <DiscoveryPage /> },
          { path: '/listings', element: <ListingsPage /> },
          { path: '/orders', element: <OrdersPage /> },
          { path: '/orders/:id', element: <OrderDetailPage /> },
          { path: '/ledger', element: <LedgerPage /> },
          { path: '/messages', element: <MessagesPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
      mutations: { retry: 0 },
    },
  });
}

export function App({ initialPath, queryClient }: { initialPath?: string; queryClient?: QueryClient }) {
  const router = initialPath ? createMemoryRouter(routes, { initialEntries: [initialPath] }) : createBrowserRouter(routes);
  const qc = queryClient ?? makeQueryClient();
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
