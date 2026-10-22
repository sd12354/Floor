import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { state } from '@/mocks/store';
import { getToken, setToken } from '@/lib/authToken';
import { renderApp } from '@/test/render';

describe('login', () => {
  it('sends a signed-out visitor to the sign-in page, then back to where they were going', async () => {
    setToken(null);
    const user = userEvent.setup();
    renderApp('/orders');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), state.auth.email);
    await user.type(screen.getByLabelText('Password'), state.auth.password);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(getToken()).toBe('mock-token');
  });

  it('shows the server error for a wrong password and stays signed out', async () => {
    setToken(null);
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Email'), state.auth.email);
    await user.type(screen.getByLabelText('Password'), 'not-the-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password');
    expect(getToken()).toBeNull();
  });

  it('validates the form before calling the API', async () => {
    setToken(null);
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Sign in' });
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
  });

  it('first run: creates the account, checking length and confirmation', async () => {
    setToken(null);
    state.auth.hasUsers = false;
    const user = userEvent.setup();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'me@floor.test');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await user.clear(screen.getByLabelText('Confirm password'));
    await user.type(screen.getByLabelText('Password'), 'long-enough-pass');
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough-pass');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(getToken()).toBe('mock-token'));
    expect(state.auth).toMatchObject({ hasUsers: true, email: 'me@floor.test' });
  });

  it('signing out clears the token and returns to the sign-in page', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const [signOut] = await screen.findAllByRole('button', { name: /Sign out/ });
    await user.click(signOut!);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });

  it('an expired session (401 from the API) drops back to sign-in', async () => {
    server.use(http.get('/api/v1/account', () => HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue' } }, { status: 401 })));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});
