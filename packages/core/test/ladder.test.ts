import { describe, expect, it } from 'vitest';
import { decide, holdDeadline, type MarginResult } from '../src/index.js';

const created = '2026-10-20T10:00:00.000Z';
const now = '2026-10-20T11:00:00.000Z';

function margin(netProfitCents: number, revenue = 10000): MarginResult {
  return { ebayFeesCents: 0, netProfitCents, netMarginPct: netProfitCents / revenue };
}

const base = { smallLossToleranceCents: 500, stock: 10, now, orderCreatedAt: created, handlingTimeDays: 3 };

describe('holdDeadline', () => {
  it('is createdAt + handlingTimeDays*24h - 12h', () => {
    expect(holdDeadline(created, 3).toISOString()).toBe('2026-10-22T22:00:00.000Z');
    expect(holdDeadline(created, 1).toISOString()).toBe('2026-10-20T22:00:00.000Z');
  });
});

describe('decide', () => {
  it('fulfils within tolerance when margin >= 0', () => {
    expect(decide({ ...base, margin: margin(1500) })).toEqual({ action: 'fulfil', reason: 'within_tolerance' });
    expect(decide({ ...base, margin: margin(0) })).toEqual({ action: 'fulfil', reason: 'within_tolerance' });
  });

  it('fulfils as small loss when loss within tolerance', () => {
    expect(decide({ ...base, margin: margin(-499) })).toEqual({ action: 'fulfil', reason: 'small_loss' });
    expect(decide({ ...base, margin: margin(-500) })).toEqual({ action: 'fulfil', reason: 'small_loss' });
  });

  it('holds below floor with the contract deadline', () => {
    expect(decide({ ...base, margin: margin(-501) })).toEqual({
      action: 'hold',
      reason: 'below_floor',
      deadline: '2026-10-22T22:00:00.000Z',
    });
  });

  it('cancels with no_decision once the deadline has passed', () => {
    expect(decide({ ...base, margin: margin(-501), now: '2026-10-22T22:00:00.000Z' })).toEqual({ action: 'cancel', reason: 'no_decision' });
    expect(decide({ ...base, margin: margin(-501), now: '2026-10-25T00:00:00.000Z' })).toEqual({ action: 'cancel', reason: 'no_decision' });
  });

  it('cancels out_of_stock regardless of margin', () => {
    expect(decide({ ...base, margin: margin(5000), stock: 0 })).toEqual({ action: 'cancel', reason: 'out_of_stock' });
    expect(decide({ ...base, margin: margin(-9000), stock: 0 })).toEqual({ action: 'cancel', reason: 'out_of_stock' });
  });

  it('accepts Date objects', () => {
    expect(decide({ ...base, margin: margin(-600), now: new Date(now), orderCreatedAt: new Date(created) }).action).toBe('hold');
  });

  it('tolerance sign is normalised', () => {
    expect(decide({ ...base, margin: margin(-400), smallLossToleranceCents: -500 })).toEqual({ action: 'fulfil', reason: 'small_loss' });
  });

  it('rejects invalid dates', () => {
    expect(() => decide({ ...base, margin: margin(-600), now: 'nope' })).toThrow(RangeError);
  });
});
