import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { resetState } from '@/mocks/store';
import { renderApp } from '@/test/render';

beforeEach(() => resetState());

async function fillAddress(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Street address'), '1 Main St');
  await user.type(screen.getByLabelText('City'), 'Austin');
  await user.type(screen.getByLabelText('State'), 'TX');
  await user.type(screen.getByLabelText('ZIP code'), '78701');
}

describe('Set up eBay listing basics', () => {
  it('checks the address before calling the API', async () => {
    const user = userEvent.setup();
    let called = false;
    server.use(http.post('*/account/ebay/setup', () => { called = true; return HttpResponse.json({}); }));
    renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: 'Set up my eBay account' }));
    expect(screen.getByText('Enter the street address')).toBeInTheDocument();
    expect(screen.getByText('Enter the city')).toBeInTheDocument();
    expect(screen.getByText('Enter the state')).toBeInTheDocument();
    expect(screen.getByText('Enter the ZIP code')).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it('sends a US address and shows copyable .env lines with the chosen category', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.use(http.post('*/account/ebay/setup', async ({ request }) => {
      sent = await request.clone().json();
      return undefined; // fall through to the default mock handler
    }));
    renderApp('/settings');
    await fillAddress(user);
    await user.type(screen.getByLabelText(/What will you sell/), 'yoga mat');
    await user.click(screen.getByRole('button', { name: 'Set up my eBay account' }));

    const env = await screen.findByTestId('env-lines');
    expect(sent).toEqual({ location: { addressLine1: '1 Main St', city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', country: 'US' }, categoryQuery: 'yoga mat' });
    expect(env).toHaveTextContent('EBAY_FULFILLMENT_POLICY_ID=6000000001');
    expect(env).toHaveTextContent('EBAY_MERCHANT_LOCATION_KEY=floor-default');
    expect(env).toHaveTextContent('EBAY_DEFAULT_CATEGORY_ID=11700'); // best match preselected
    expect(screen.getByText(/Paste these lines into/)).toHaveTextContent('apps/api/.env');
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Health & Beauty/ }));
    expect(screen.getByTestId('env-lines')).toHaveTextContent('EBAY_DEFAULT_CATEGORY_ID=26395');
  });

  it('without a category search it leaves a placeholder line instead of inventing an id', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    await fillAddress(user);
    await user.click(screen.getByRole('button', { name: 'Set up my eBay account' }));
    expect(await screen.findByTestId('env-lines')).toHaveTextContent('# EBAY_DEFAULT_CATEGORY_ID=<pick a category above>');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('shows the server message when eBay is not connected', async () => {
    const user = userEvent.setup();
    server.use(http.post('*/account/ebay/setup', () => HttpResponse.json({ error: { code: 'EBAY_NOT_CONNECTED', message: 'Connect your eBay account first (Settings > Connect eBay), then run setup.' } }, { status: 409 })));
    renderApp('/settings');
    await fillAddress(user);
    await user.click(screen.getByRole('button', { name: 'Set up my eBay account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connect your eBay account first');
  });
});

describe('returning from eBay', () => {
  it('toasts a successful connection', async () => {
    renderApp('/settings?ebay=connected');
    expect(await screen.findByText('eBay connected')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument());
  });

  it('explains a declined or failed connection even though the app then sends you to onboarding', async () => {
    resetState({ fresh: true });
    renderApp('/settings?ebay=denied');
    expect(await screen.findByText('eBay was not connected')).toBeInTheDocument();
    expect(await screen.findByText('Connect your eBay account')).toBeInTheDocument();
  });

  it('ignores unknown values', async () => {
    renderApp('/settings?ebay=wat');
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByText('eBay connected')).not.toBeInTheDocument();
  });
});
