import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { resetState, state } from '@/mocks/store';
import { adRateError, rulesFromAccount } from '@/lib/rules';
import { accountFees } from '@/lib/money';
import { demoAccount } from '@/mocks/fixtures/account';
import { renderApp } from '@/test/render';

beforeEach(() => resetState());

const exampleText = async () => (await screen.findByText(/An item that costs/)).closest('div')?.textContent ?? '';

describe('promoted ads rules', () => {
  it('the ad rate replaces promotedPct only while the switch is on', () => {
    const fees = { ...demoAccount.fees, promotedPct: 0.03 };
    expect(accountFees({ fees }).promotedPct).toBe(0.03);
    expect(accountFees({ fees, promotedAdsEnabled: false, promotedAdRatePct: 0.05 }).promotedPct).toBe(0.03);
    expect(accountFees({ fees, promotedAdsEnabled: true, promotedAdRatePct: 0.05 }).promotedPct).toBe(0.05);
  });

  it('adRateError checks the range and the room left for the target margin', () => {
    const d = { ...rulesFromAccount(demoAccount), promotedAdsEnabled: true };
    expect(adRateError({ ...d, promotedAdsEnabled: false, promotedAdRatePct: 0.001 })).toBeNull();
    expect(adRateError({ ...d, promotedAdRatePct: 0.02 })).toBeNull();
    expect(adRateError({ ...d, promotedAdRatePct: 0.01 })).toMatch(/lowest ad rate is 2%/);
    expect(adRateError({ ...d, promotedAdRatePct: 1.5 })).toMatch(/above 100%/);
    expect(adRateError({ ...d, promotedAdRatePct: 0.7 })).toMatch(/no room/);
  });
});

describe('Settings > Promoted listings', () => {
  it('is off by default, explains itself in plain words, and shows no rate field until switched on', async () => {
    renderApp('/settings');
    const toggle = await screen.findByRole('checkbox', { name: /Promote new listings/ });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText('Ad rate')).not.toBeInTheDocument();
    expect(screen.getByText(/only on a sale that comes through the ad/)).toBeInTheDocument();
    expect(await exampleText()).not.toMatch(/promoted ad rate/);
  });

  it('switching on shows 2% and the example line gains the rate and a higher price', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    const before = await exampleText();
    const listedBefore = /lists at\s*\$([\d.]+)/.exec(before)?.[1];
    await user.click(await screen.findByRole('checkbox', { name: /Promote new listings/ }));
    expect(screen.getByLabelText('Ad rate')).toHaveValue(2);
    const after = await exampleText();
    expect(after).toMatch(/including the 2\.0% promoted ad rate/);
    expect(Number(/lists at\s*\$([\d.]+)/.exec(after)?.[1])).toBeGreaterThan(Number(listedBefore));
    await user.clear(screen.getByLabelText('Ad rate'));
    await user.type(screen.getByLabelText('Ad rate'), '5');
    await waitFor(async () => expect(await exampleText()).toMatch(/including the 5\.0% promoted ad rate/));
    // the manual promoted-rate field is locked while the switch is on
    expect(screen.getByLabelText('Promoted listings rate (outside Floor)')).toBeDisabled();
  });

  it('refuses a rate under eBay minimum and blocks saving', async () => {
    const user = userEvent.setup();
    renderApp('/settings');
    await user.click(await screen.findByRole('checkbox', { name: /Promote new listings/ }));
    await user.clear(screen.getByLabelText('Ad rate'));
    await user.type(screen.getByLabelText('Ad rate'), '1');
    expect(screen.getByText(/lowest ad rate is 2%/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('saves the switch and rate, and live listings show the Promoted badge', async () => {
    const user = userEvent.setup();
    let sent: Record<string, unknown> = {};
    server.use(http.patch('*/account', async ({ request }) => { sent = (await request.clone().json()) as Record<string, unknown>; return undefined; }));
    renderApp('/settings');
    await user.click(await screen.findByRole('checkbox', { name: /Promote new listings/ }));
    await user.clear(screen.getByLabelText('Ad rate'));
    await user.type(screen.getByLabelText('Ad rate'), '4');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent).toMatchObject({ promotedAdsEnabled: true, promotedAdRatePct: 0.04 }));
    await waitFor(() => expect(state.account.promotedAdsEnabled).toBe(true));
    expect(state.listings.filter((l) => l.status === 'active').every((l) => l.promoted && l.promotedRatePct === 0.04)).toBe(true);
    expect(state.listings.filter((l) => l.status !== 'active').some((l) => l.promoted)).toBe(false);
  });

  it('tells the seller when ads are waiting and to reconnect eBay', async () => {
    server.use(http.get('*/account', () => HttpResponse.json({ ...state.account, promotedAdsEnabled: true, promotedAdsPending: 3 })));
    renderApp('/settings');
    expect(await screen.findByText(/3 listings are waiting for their ad/)).toBeInTheDocument();
    expect(screen.getByText(/reconnect eBay once/)).toBeInTheDocument();
  });
});

describe('Listings > Promoted badge', () => {
  it('marks promoted listings only', async () => {
    state.listings[0]!.promoted = true;
    state.listings[0]!.promotedRatePct = 0.03;
    renderApp('/listings');
    const badge = await screen.findByText('Promoted');
    expect(badge).toHaveAttribute('title', 'Promoted on eBay at 3.0%');
    expect(screen.getAllByText('Promoted')).toHaveLength(1);
    expect(within(badge.closest('tr') as HTMLElement).getByText(state.listings[0]!.title)).toBeInTheDocument();
  });
});
