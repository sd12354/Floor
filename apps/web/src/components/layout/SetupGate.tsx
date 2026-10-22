import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useAccount } from '@/api/hooks';
import { ErrorState, useToast } from '@/components/ui';
import { errorMessage } from '@/api/client';
import { needsOnboarding } from '@/lib/setup';
import { introSeen } from '@/lib/intro';

/** Sends a fresh account to /onboarding until eBay and a supplier are connected. */
export function SetupGate() {
  const { data, isPending, error, refetch } = useAccount();
  const location = useLocation();
  useEbayReturnToast(!isPending && !error);

  if (isPending) return <div className="min-h-dvh" aria-busy="true" />;
  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <ErrorState message={`${errorMessage(error)}. Is the API running on :4000? Set VITE_USE_MOCKS=true to run without it.`} onRetry={() => refetch()} />
      </div>
    );
  }
  // First visit in this browser: the splash comes before everything else.
  if (!introSeen() && (location.pathname === '/' || location.pathname === '/onboarding')) {
    return <Navigate to="/welcome" replace />;
  }
  if (data && needsOnboarding(data) && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

const EBAY_RETURN: Record<string, { ok: boolean; title: string; text: string }> = {
  connected: { ok: true, title: 'eBay connected', text: 'Your eBay account is linked.' },
  denied: { ok: false, title: 'eBay was not connected', text: 'You declined access on eBay. Connect again when you are ready.' },
  failed: { ok: false, title: 'eBay connection failed', text: 'eBay would not complete the connection. Try again from Settings.' },
};

/** eBay sends the browser back to `?ebay=connected|denied|failed`; say what happened once, then tidy the URL. */
function useEbayReturnToast(ready: boolean) {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const shown = useRef(false);
  const outcome = EBAY_RETURN[params.get('ebay') ?? ''];
  useEffect(() => {
    if (!ready || !outcome || shown.current) return;
    shown.current = true;
    if (outcome.ok) toast.success(outcome.title, outcome.text);
    else toast.error(outcome.title, outcome.text);
    const next = new URLSearchParams(params);
    next.delete('ebay');
    setParams(next, { replace: true });
  }, [ready, outcome, params, setParams, toast]);
}
