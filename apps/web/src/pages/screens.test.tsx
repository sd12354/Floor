import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/render';
import { resetState } from '@/mocks/store';

describe('Dashboard', () => {
  it('shows float, today, health and the held order needing attention', async () => {
    renderApp('/');
    expect(await screen.findByText('Float outstanding', {}, { timeout: 4000 })).toBeInTheDocument();
    // 6 orders in float: 1180 + 1380 + 2240 + 1010 + 720 + 1430 = 7960
    expect((await screen.findAllByText('$79.60')).length).toBeGreaterThan(0);
    expect(screen.getByText('Account health')).toBeInTheDocument();
    expect(screen.getAllByText('OK').length).toBeGreaterThan(0);
    // Health meters carry a text state, not just a colour.
    expect(screen.getByRole('meter', { name: /Late shipments: .* ok$/ })).toBeInTheDocument();
    const attention = screen.getByText('Needs attention').closest('section')!;
    expect(await within(attention).findByText(/^Held: /)).toBeInTheDocument();
    expect(within(attention).getByText(/^Queued: /)).toBeInTheDocument();
    expect(within(attention).getByText(/^Blocked: /)).toBeInTheDocument();
  });

  it('redirects to onboarding when eBay is not connected', async () => {
    resetState({ fresh: true });
    renderApp('/');
    expect(await screen.findByText('Connect your eBay account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect eBay' })).toBeEnabled();
  });
});

describe('Listings', () => {
  it('lists status tabs, shows the paused reason, and refuses a price below the floor', async () => {
    const user = userEvent.setup();
    renderApp('/listings?status=paused');
    // pauseReason arrives as the API code (`below_floor`) and is rendered as plain words with the floor price.
    expect(await screen.findByText(/Paused: Supplier cost rose; needs at least \$\d+\.\d\d to clear your floor/)).toBeInTheDocument();
    expect(screen.getByText(/Paused: Supplier out of stock/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Active/ }));
    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    await user.click(editButtons[0]!);

    const dialog = await screen.findByRole('dialog');
    const price = within(dialog).getByLabelText('Price');
    await user.clear(price);
    await user.type(price, '5.00');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    // 422 PRICE_BELOW_FLOOR carries details.floorPriceCents; the field explains it in dollars.
    expect(await within(dialog).findByText(/\$5\.00 is below your 10% floor\. The lowest price that clears it is \$\d+\.\d\d\./)).toBeInTheDocument();
  });
});

describe('Orders', () => {
  it('shows the held order with Fulfil and Cancel and resolves it', async () => {
    const user = userEvent.setup();
    renderApp('/orders?status=held');
    // Row actions render twice (desktop column + phone stack); jsdom does not apply the CSS that hides one.
    const [fulfil] = await screen.findAllByRole('button', { name: 'Fulfil anyway' });
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBeGreaterThan(0);
    expect(screen.getByText('-$2.37')).toBeInTheDocument();
    await user.click(fulfil!);
    await waitFor(() => expect(screen.getByText('No orders are held')).toBeInTheDocument());
  });

  it('renders the order detail timeline and P&L', async () => {
    renderApp('/orders/ord_1043');
    expect(await screen.findByText('Buyer paid')).toBeInTheDocument();
    expect(screen.getByText('Ordered from supplier')).toBeInTheDocument();
    expect(screen.getByText('Tracking pushed to eBay')).toBeInTheDocument();
    expect(screen.getByText('Profit and loss')).toBeInTheDocument();
    expect(screen.getByText('+$7.43')).toBeInTheDocument();
    expect(screen.getByText(/ordered from the supplier right away/)).toBeInTheDocument();
  });
});

describe('Simulate sale', () => {
  it('sends priceDriftPct as a percentage: +20% on a $18.99 listing is still a fulfil, +100% is a hold', async () => {
    const user = userEvent.setup();
    resetState();
    renderApp('/listings?status=active');
    const [simulate] = await screen.findAllByRole('button', { name: 'Simulate sale' });
    await user.click(simulate!);
    const dialog = await screen.findByRole('dialog');
    const slider = within(dialog).getByLabelText(/Supplier price drift/);
    // jsdom range inputs: set the value and fire change so React sees +60.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(slider, { target: { value: '20' } });
    // A fraction bug (0.2 read as 20%... or 20 read as 2000%) would flip this preview.
    expect(within(dialog).getByText(/Floor will order from the supplier immediately/)).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '100' } });
    expect(within(dialog).getByText(/Floor will hold the order/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Create paid order' }));
    expect(await screen.findByText('Held below the floor.', {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
