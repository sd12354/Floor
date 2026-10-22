import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage } from '@/api/client';
import { useAuthStatus, useSignIn } from '@/api/hooks';
import { Wordmark } from '@/components/layout/Wordmark';
import { Button, Card, ErrorState, TextField } from '@/components/ui';
import { useAuthToken } from '@/lib/useAuthToken';

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sign in, or on a fresh install create the one seller account. */
export function LoginPage() {
  const token = useAuthToken();
  const location = useLocation();
  const navigate = useNavigate();
  const status = useAuthStatus();
  const mode = status.data?.hasUsers === false ? 'signup' : 'signin';
  const signIn = useSignIn(mode);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/';
  if (token) return <Navigate to={from === '/login' ? '/' : from} replace />;

  const errors = {
    email: EMAIL_RE.test(email.trim()) ? '' : 'Enter a valid email address',
    password: mode === 'signup' && password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters` : password ? '' : 'Enter your password',
    confirm: mode === 'signup' && confirm !== password ? 'Passwords do not match' : '',
  };
  const invalid = Boolean(errors.email || errors.password || errors.confirm);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    signIn.mutate({ email: email.trim(), password }, { onSuccess: () => navigate(from === '/login' ? '/' : from, { replace: true }) });
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <Wordmark size="lg" />
        {status.data && (
          <>
            <h1 className="font-display text-[26px] mt-8">{mode === 'signup' ? 'Create your account' : 'Sign in'}</h1>
            <p className="text-muted text-[14.5px] mt-1.5 mb-5">
              {mode === 'signup' ? 'This is a one-time setup. Floor has a single seller account, and everything stays on this machine.' : 'Your eBay store, never below the floor.'}
            </p>
          </>
        )}

        {status.isPending ? (
          <div className="mt-8 h-52" aria-busy="true" />
        ) : status.error ? (
          <ErrorState message={`${errorMessage(status.error)}. Is the API running on :4000?`} onRetry={() => status.refetch()} />
        ) : (
          <Card>
            <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
              <TextField label="Email" type="email" autoComplete="username" inputMode="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} error={show('email')} />
              <TextField
                label="Password"
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={show('password')}
                hint={mode === 'signup' && !touched ? `At least ${MIN_PASSWORD} characters.` : undefined}
              />
              {mode === 'signup' && (
                <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={show('confirm')} />
              )}
              {signIn.error && (
                <p role="alert" className="text-[13.5px] text-floor">{errorMessage(signIn.error)}</p>
              )}
              <Button type="submit" variant="primary" loading={signIn.isPending} className="w-full mt-1">
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
