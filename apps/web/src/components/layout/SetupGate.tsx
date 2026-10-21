import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAccount } from '@/api/hooks';
import { ErrorState } from '@/components/ui';
import { errorMessage } from '@/api/client';
import { needsOnboarding } from '@/lib/setup';

/** Sends a fresh account to /onboarding until eBay and a supplier are connected. */
export function SetupGate() {
  const { data, isPending, error, refetch } = useAccount();
  const location = useLocation();

  if (isPending) return <div className="min-h-dvh" aria-busy="true" />;
  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <ErrorState message={`${errorMessage(error)}. Is the API running on :4000? Set VITE_USE_MOCKS=true to run without it.`} onRetry={() => refetch()} />
      </div>
    );
  }
  if (data && needsOnboarding(data) && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}
