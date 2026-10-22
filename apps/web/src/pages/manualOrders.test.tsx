import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { state } from '@/mocks/store';
import { renderApp } from '@/test/render';

// Seeded order ord_1049: sale $24.99, eBay fees $3.80, floor 10%, target 20%. The most that clears the floor is $18.69.
const ORDER = '/orders/ord_1049';
const order = () => state.orders.find((o) => o.id === 'ord_1049')!;

async function fillAmounts(user: ReturnType<typeof userEvent.setup>, cost: string, shipping: string) {
  const c = screen.getByLabelText('Item cost');
  const s = screen.getByLabelText('Shipping');
  await user.clear(c);
  await user.type(c, cost);
  await user.clear(s);
  await user.type(s, shipping);
}

describe('To order tab and dashboard hint', () => {
  it('lists the order waiting for the seller under To order', async () => {
    const user = userEvent.setup();
    renderApp('/orders');
    const tab = await screen.findByRole('tab', { name: /To order/ });
    await waitFor(() => expect(tab).toHaveTextContent('To order1'));
    await user.click(tab);
    expect(await screen.findByText('Elena Rossi', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Waiting for you to order from your supplier')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Order now' }).length).toBeGreaterThan(0);
    // Other tabs do not show it.
    await user.click(screen.getByRole('tab', { name: /Held/ }));
    await waitFor(() => expect(screen.queryByText('Elena Rossi', { exact: false })).not.toBeInTheDocument());
  });

  it('shows an empty state when nothing is waiting', async () => {
    order().status = 'ordered';
    renderApp('/orders?status=awaiting_supplier');
    expect(await screen.findByText('Nothing to order')).toBeInTheDocument();
  });

  it('the dashboard says how many orders are waiting for a supplier order', async () => {
    renderApp('/');
    expect(await screen.findByText(/1 order is waiting for you to order from your supplier/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText(/^To order: /)).toBeInTheDocument();
  });
});

describe('Order from your supplier', () => {
  it('leads with the most the seller can pay and offers a copy button for each ship-to line', async () => {
    const user = userEvent.setup();
    renderApp(ORDER);
    expect(await screen.findByRole('heading', { name: 'Order from your supplier' })).toBeInTheDocument();
    expect(screen.getByText('Pay at most')).toBeInTheDocument();
    expect(screen.getByText('$18.69')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open on supplier\.example\.com/ })).toHaveAttribute('href', 'https://supplier.example.com/p/bamboo-cutlery-set');

    await user.click(screen.getByRole('button', { name: 'Copy city' }));
    expect(await navigator.clipboard.readText()).toBe('Portland');
    await user.click(screen.getByRole('button', { name: 'Copy address line 2' }));
    expect(await navigator.clipboard.readText()).toBe('Apt 4B');
    await user.click(screen.getByRole('button', { name: 'Copy full address' }));
    expect(await navigator.clipboard.readText()).toBe('Elena Rossi\n88 Harbor View Drive\nApt 4B\nPortland, OR 97204\nUS');
  });

  it('the margin readout follows the costs the seller types, in whole cents', async () => {
    const user = userEvent.setup();
    renderApp(ORDER);
    await screen.findByRole('heading', { name: 'Order from your supplier' });
    expect(screen.getByText('Type what your supplier quoted')).toBeInTheDocument();

    await fillAmounts(user, '12.00', '2.10');
    // $24.99 - $3.80 fees - $14.10 = $7.09, 28.4%
    expect(await screen.findByText('+$7.09', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('28.37%')).toBeInTheDocument();
    expect(screen.getByText('Clears your 10% floor and your target')).toBeInTheDocument();

    await fillAmounts(user, '20.00', '1.00');
    // Still a profit, but 0.8% is under the floor: the readout must say so in words.
    expect(await screen.findByText('Below your 10% floor', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('+$0.19')).toBeInTheDocument();
    expect(screen.getByText('That is $2.31 over the most Floor allows.')).toBeInTheDocument();

    await fillAmounts(user, '30.00', '1.00');
    expect(await screen.findByText('You would lose money on this order', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('-$9.81')).toBeInTheDocument();
  });

  it('rejects malformed amounts and a missing order number before calling the API', async () => {
    const user = userEvent.setup();
    renderApp(ORDER);
    await screen.findByRole('heading', { name: 'Order from your supplier' });
    await fillAmounts(user, '12.345', 'abc');
    await user.click(screen.getByRole('button', { name: 'Record supplier order' }));
    expect(screen.getByText('Enter a dollar amount, like 12.50.')).toBeInTheDocument();
    expect(screen.getByText('Enter what you paid for shipping. Use 0 if it was free.')).toBeInTheDocument();
    expect(screen.getByText('Paste the order number your supplier gave you.')).toBeInTheDocument();
    expect(screen.getByLabelText('Item cost')).toHaveFocus();
    expect(order().status).toBe('awaiting_supplier');
  });

  it('records below the floor only after an explicit confirmation, which is sent as confirmBelowFloor', async () => {
    const user = userEvent.setup();
    renderApp(ORDER);
    await screen.findByRole('heading', { name: 'Order from your supplier' });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    await fillAmounts(user, '20.00', '1.00');
    await user.type(screen.getByLabelText('Supplier order number'), 'ALI-5521');
    const box = await screen.findByRole('checkbox', { name: /below my 10% floor/ }, { timeout: 3000 });
    expect(box).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Record supplier order' }));
    expect(screen.getByText('Tick the box to confirm you want to record an order below your floor.')).toBeInTheDocument();
    expect(order().status).toBe('awaiting_supplier');

    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Record supplier order' }));
    expect(await screen.findByRole('heading', { name: 'Add tracking' })).toBeInTheDocument();

    expect(order()).toMatchObject({ status: 'ordered', supplierOrderId: 'ALI-5521', supplierCostCents: 2000, supplierShippingCents: 100, netProfitCents: 19 });
    const ev = state.events.find((e) => e.orderId === 'ord_1049' && e.type === 'order.supplier_ordered');
    expect(ev?.payload).toEqual({ confirmBelowFloor: true });
    expect(state.ledger.filter((l) => l.orderId === 'ord_1049').map((l) => l.kind).sort()).toEqual(['ebay_fee', 'sale', 'supplier_cost', 'supplier_shipping']);
  });

  it('shows the BELOW_FLOOR details when the server refuses, and nothing is recorded', async () => {
    // The live check wrongly says "fine", so the seller submits and it is the server that refuses.
    server.use(http.post('/api/v1/orders/:id/supplier-quote', () => HttpResponse.json({ netProfitCents: 900, netMarginPct: 0.36, ebayFeesCents: 380, maxSupplierCostCents: 1869, meetsFloor: true })));
    const user = userEvent.setup();
    renderApp(ORDER);
    await screen.findByRole('heading', { name: 'Order from your supplier' });
    await fillAmounts(user, '20.00', '1.00');
    await user.type(screen.getByLabelText('Supplier order number'), 'ALI-77');
    await screen.findByText('Clears your 10% floor and your target', {}, { timeout: 3000 });

    await user.click(screen.getByRole('button', { name: 'Record supplier order' }));
    const alert = await screen.findByText('Floor did not record this order.');
    const box = alert.closest('[role="alert"]') as HTMLElement;
    expect(within(box).getByText('0.76%')).toBeInTheDocument();
    expect(box).toHaveTextContent('net +$0.19');
    expect(box).toHaveTextContent('The most you can pay is $18.69');
    expect(order().status).toBe('awaiting_supplier');
    expect(state.ledger.some((l) => l.orderId === 'ord_1049')).toBe(false);

    // The refusal reveals the confirmation box so the seller can still go ahead knowingly.
    const confirm = screen.getByRole('checkbox', { name: /below my 10% floor/ });
    await user.click(confirm);
    await user.click(screen.getByRole('button', { name: 'Record supplier order' }));
    expect(await screen.findByRole('heading', { name: 'Add tracking' })).toBeInTheDocument();
  });

  it('clears the below-floor confirmation on any edit, even when the amounts come back', async () => {
    const user = userEvent.setup();
    renderApp(ORDER);
    await screen.findByRole('heading', { name: 'Order from your supplier' });
    await fillAmounts(user, '20.00', '1.00');
    await user.type(screen.getByLabelText('Supplier order number'), 'ALI-1');
    const box = await screen.findByRole('checkbox', { name: /below my 10% floor/ }, { timeout: 3000 });
    await user.click(box);
    expect(box).toBeChecked();
    await fillAmounts(user, '21.00', '1.00');
    await fillAmounts(user, '20.00', '1.00');
    const again = await screen.findByRole('checkbox', { name: /below my 10% floor/ }, { timeout: 3000 });
    expect(again).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Record supplier order' }));
    expect(screen.getByText('Tick the box to confirm you want to record an order below your floor.')).toBeInTheDocument();
    expect(order().status).toBe('awaiting_supplier');
  });

  it('shows enough decimals that a margin just under the floor never reads as the floor', async () => {
    state.account.pricingRule.floorPct = 0.15;
    const user = userEvent.setup();
    renderApp(ORDER);
    await screen.findByRole('heading', { name: 'Order from your supplier' });
    // $24.99 - $3.80 - $17.45 = $3.74 -> 14.97%, under 15%.
    await fillAmounts(user, '17.45', '0');
    expect(await screen.findByText('Below your 15% floor', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('14.97%')).toBeInTheDocument();
  });

  it('walks ordered, tracking, then delivered', async () => {
    const user = userEvent.setup();
    renderApp(ORDER);
    await screen.findByRole('heading', { name: 'Order from your supplier' });
    await fillAmounts(user, '12.00', '2.10');
    await user.type(screen.getByLabelText('Supplier order number'), 'ALI-9000');
    await screen.findByText('+$7.09', {}, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Record supplier order' }));

    // Step 3: tracking, with validation first.
    expect(await screen.findByRole('heading', { name: 'Add tracking' })).toBeInTheDocument();
    expect(order()).toMatchObject({ status: 'ordered', supplierCostCents: 1200, supplierShippingCents: 210, netProfitCents: 709 });
    await user.click(screen.getByRole('button', { name: 'Add tracking and tell the buyer' }));
    expect(screen.getByText('Enter the tracking number.')).toBeInTheDocument();
    expect(screen.getByText('Enter the carrier, like USPS or YunExpress.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tracking number'), '9400111899223456789');
    await user.type(screen.getByLabelText('Carrier'), 'USPS');
    await user.click(screen.getByRole('button', { name: 'Add tracking and tell the buyer' }));

    // Step 4: delivered.
    expect(await screen.findByRole('heading', { name: 'Mark delivered' })).toBeInTheDocument();
    expect(order()).toMatchObject({ status: 'shipped', carrier: 'USPS', trackingNumber: '9400111899223456789' });
    expect(order().payoutExpectedAt).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mark delivered' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument());
    expect(order().status).toBe('delivered');
    expect(screen.getByText('You marked it delivered')).toBeInTheDocument();
    expect(screen.getByText('Tracking pushed to eBay')).toBeInTheDocument();
    expect(screen.getByText('You ordered from your supplier')).toBeInTheDocument();
  });

  it('cancels a waiting order only after a second confirmation', async () => {
    const user = userEvent.setup();
    renderApp(ORDER);
    await screen.findByRole('heading', { name: 'Order from your supplier' });
    await user.click(screen.getByRole('button', { name: 'Cancel this order' }));
    expect(order().status).toBe('awaiting_supplier');
    await user.click(screen.getByRole('button', { name: 'Yes, cancel the order' }));
    await waitFor(() => expect(order().status).toBe('cancelled'));
    expect(state.ledger.some((l) => l.orderId === 'ord_1049')).toBe(false);
  });
});
