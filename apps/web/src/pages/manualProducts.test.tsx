import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetState, state } from '@/mocks/store';
import { renderApp } from '@/test/render';

const IMG1 = 'https://cdn.example.com/a.jpg';
const IMG2 = 'https://cdn.example.com/b.jpg';

describe('Your products', () => {
  it('lists the seller\'s products and flags a lead time that is too slow to list', async () => {
    renderApp('/products');
    expect(await screen.findByText('Bamboo cutlery travel set with case')).toBeInTheDocument();
    expect(screen.getByText('Silicone stretch lids, 6 sizes')).toBeInTheDocument();
    expect(screen.getByText('12 days, too slow')).toBeInTheDocument();
  });

  it('adds a product: validates every field first, explains lead time, then saves integer cents', async () => {
    const user = userEvent.setup();
    renderApp('/products');
    await screen.findByText('Bamboo cutlery travel set with case');
    await user.click(screen.getByRole('button', { name: /Add product/ }));
    const dialog = await screen.findByRole('dialog');

    // Lead time is explained in plain words, with the account's handling time.
    expect(within(dialog).getByText(/Days from your order until it reaches the buyer\. It must not exceed your handling time of 3 days, or the listing cannot be published\./)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('7 fields need fixing');
    expect(within(dialog).getByText('Use 3 to 80 characters.')).toBeInTheDocument();
    expect(within(dialog).getByText('Add at least one image URL.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a dollar amount, like 12.50.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a whole number of days from 1 to 60.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Title')).toHaveFocus();
    expect(state.manualProducts).toHaveLength(2);

    // Contract ranges: https only, cost above zero, lead time 1 to 60.
    await user.type(within(dialog).getByLabelText('Title'), 'ab');
    await user.type(within(dialog).getByLabelText('Image URLs'), 'http://cdn.example.com/a.jpg');
    await user.type(within(dialog).getByLabelText('Cost per unit'), '0');
    await user.type(within(dialog).getByLabelText('Lead time (days)'), '61');
    await user.type(within(dialog).getByLabelText('Supplier link (optional)'), 'ftp://x.example.com');
    expect(within(dialog).getByText('Use 3 to 80 characters.')).toBeInTheDocument();
    expect(within(dialog).getByText('Image 1 must be a full https:// link.')).toBeInTheDocument();
    expect(within(dialog).getByText('Cost must be more than $0.00.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a whole number of days from 1 to 60.')).toBeInTheDocument();
    expect(within(dialog).getByText('Must be a full https:// link, or leave it blank.')).toBeInTheDocument();
    // The explanation stays visible next to the error.
    expect(within(dialog).getByText(/must not exceed your handling time of 3 days/)).toBeInTheDocument();

    // 13 images is one too many.
    const images = within(dialog).getByLabelText('Image URLs');
    await user.clear(images);
    await user.click(images);
    await user.paste(Array.from({ length: 13 }, (_, i) => `https://cdn.example.com/${i}.jpg`).join('\n'));
    expect(within(dialog).getByText('Use at most 12 images (you have 13).')).toBeInTheDocument();

    // Fix everything.
    await user.clear(images);
    await user.click(images);
    await user.paste(`${IMG1}\n${IMG2}`);
    await user.clear(within(dialog).getByLabelText('Title'));
    await user.type(within(dialog).getByLabelText('Title'), 'Glass spice jars, set of 6');
    await user.type(within(dialog).getByLabelText('Description'), 'Six airtight glass jars with bamboo lids.');
    await user.clear(within(dialog).getByLabelText('Cost per unit'));
    await user.type(within(dialog).getByLabelText('Cost per unit'), '8.2');
    await user.type(within(dialog).getByLabelText('Supplier shipping'), '0');
    await user.type(within(dialog).getByLabelText('Stock'), '40');
    await user.clear(within(dialog).getByLabelText('Lead time (days)'));
    await user.type(within(dialog).getByLabelText('Lead time (days)'), '5');
    await user.clear(within(dialog).getByLabelText('Supplier link (optional)'));
    // 5 days is over the 3-day handling time: allowed, but the seller is told the product will not list.
    expect(within(dialog).getByText(/Longer than your handling time\. Floor will block this product/)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Lead time (days)'));
    await user.type(within(dialog).getByLabelText('Lead time (days)'), '2');
    expect(within(dialog).queryByText(/Longer than your handling time/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Add product' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Glass spice jars, set of 6')).toBeInTheDocument();

    const saved = state.manualProducts.at(-1)!;
    expect(saved).toMatchObject({
      supplier: 'manual', title: 'Glass spice jars, set of 6', images: [IMG1, IMG2], costCents: 820, shippingCents: 0, stock: 40, handlingDays: 2, warehouseCountry: 'CN',
    });
    expect(saved.supplierSku).toMatch(/^man_/);
  });

  it('rejects a comma decimal and values past the contract limits', async () => {
    const user = userEvent.setup();
    renderApp('/products');
    await screen.findByText('Bamboo cutlery travel set with case');
    await user.click(screen.getByRole('button', { name: /Add product/ }));
    const dialog = await screen.findByRole('dialog');
    const cost = within(dialog).getByLabelText('Cost per unit');
    await user.type(cost, '12,50');
    await user.tab();
    expect(within(dialog).getByText('Enter a dollar amount, like 12.50.')).toBeInTheDocument();
    await user.clear(cost);
    await user.type(cost, '1,250.50');
    expect(within(dialog).queryByText('Enter a dollar amount, like 12.50.')).not.toBeInTheDocument();
    await user.clear(cost);
    await user.type(cost, '1000000.01');
    expect(within(dialog).getByText('Cost can be at most $1,000,000.00.')).toBeInTheDocument();
    const stock = within(dialog).getByLabelText('Stock');
    await user.type(stock, '1000001');
    await user.tab();
    expect(within(dialog).getByText('Stock can be at most 1,000,000.')).toBeInTheDocument();
  });

  it('edits only what changed, and stock 0 pauses the product\'s listings', async () => {
    const user = userEvent.setup();
    renderApp('/products');
    await screen.findByText('Bamboo cutlery travel set with case');
    await user.click(screen.getAllByRole('button', { name: 'Edit Bamboo cutlery travel set with case' })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Cost per unit')).toHaveValue('12.40');
    const stock = within(dialog).getByLabelText('Stock');
    await user.clear(stock);
    await user.type(stock, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(state.manualProducts.find((p) => p.id === 'prod_man_01')).toMatchObject({ stock: 0, costCents: 1240 });
    expect(state.listings.find((l) => l.id === 'lst_14')).toMatchObject({ status: 'paused', pauseReason: 'out_of_stock' });
  });

  it('removes an unused product but explains PRODUCT_IN_USE for one with a listing and an order', async () => {
    const user = userEvent.setup();
    renderApp('/products');
    await screen.findByText('Bamboo cutlery travel set with case');

    await user.click(screen.getAllByRole('button', { name: 'Remove Bamboo cutlery travel set with case' })[0]!);
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove product' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('It is still in use.');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('set its stock to 0');
    expect(state.manualProducts).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }));

    await user.click(screen.getAllByRole('button', { name: 'Remove Silicone stretch lids, 6 sizes' })[0]!);
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove product' }));
    await waitFor(() => expect(screen.queryByText('Silicone stretch lids, 6 sizes')).not.toBeInTheDocument());
    expect(state.manualProducts.map((p) => p.id)).toEqual(['prod_man_01']);
  });

  it('asks to connect the Manual supplier first when it is not connected', async () => {
    const user = userEvent.setup();
    state.account.supplierConnections = state.account.supplierConnections.filter((s) => s.supplier !== 'manual');
    renderApp('/products');
    expect(await screen.findByText('Connect the Manual supplier first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add product/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Connect Manual supplier' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Add product/ })).toBeEnabled());
  });
});

describe('Manual supplier elsewhere', () => {
  it('can be connected from onboarding', async () => {
    const user = userEvent.setup();
    resetState({ fresh: true });
    renderApp('/onboarding');
    await user.click(await screen.findByRole('button', { name: 'Connect Manual supplier' }));
    await waitFor(() => expect(state.account.supplierConnections.map((s) => s.supplier)).toEqual(['manual']));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });

  it('shows a lead time that exceeds the handling time as blocked in Discovery, in plain words', async () => {
    renderApp('/discovery');
    const row = (await screen.findByText('Silicone stretch lids, 6 sizes')).closest('tr')!;
    expect(within(row).getByText('Blocked: lead time is longer than your handling time')).toBeInTheDocument();
    expect(within(row).getByText('Ships too slowly')).toBeInTheDocument();
  });

  it('is reachable from Settings on a phone', async () => {
    renderApp('/settings');
    expect(await screen.findByRole('link', { name: 'Manage your products' })).toHaveAttribute('href', '/products');
  });
});
