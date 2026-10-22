import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useMe } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { ErrorState } from '@/components/ui';
import { useAuthToken } from '@/lib/useAuthToken';

/** Everything except /login needs a session. An expired session clears the token (api/client.ts) and lands here. */
export function AuthGate() {
  const token = useAuthToken();
  const location = useLocation();
  const me = useMe(!!token);

  if (!token) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (me.isPending) return <div className="min-h-dvh" aria-busy="true" />;
  if (me.error) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <ErrorState message={`${errorMessage(me.error)}. Is the API running on :4000?`} onRetry={() => me.refetch()} />
      </div>
    );
  }
  return <Outlet />;
}
