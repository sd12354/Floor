import { describe, expect, it } from 'vitest';
import { decide, holdDeadline, type MarginResult } from '../src/index.js';

const created = '2026-10-20T10:00:00.000Z';
const now = '2026-10-20T11:00:00.000Z';

function margin(netProfitCents: number, revenue = 10000): MarginResult {
  return { ebayFeesCents: 0, netProfitCents, netMarginPct: netProfitCents / revenue };
}

const base = { floorPct: 0.1, stock: 10, now, orderCreatedAt: created, handlingTimeDays: 3 };

describe('holdDeadline', () => {
  it('is createdAt + handlingTimeDays*24h - 12h', () => {
    expect(holdDeadline(created, 3).toISOString()).toBe('2026-10-22T22:00:00.000Z');
    expect(holdDeadline(created, 1).toISOString()).toBe('2026-10-20T22:00:00.000Z');
  });
});

describe('decide', () => {
  it('fulfils when the margin is at or above the floor', () => {
    expect(decide({ ...base, margin: margin(1500) })).toEqual({ action: 'fulfil', reason: 'within_tolerance' });
    expect(decide({ ...base, margin: margin(1000) })).toEqual({ action: 'fulfil', reason: 'within_tolerance' });
  });

  it('holds a profitable order that is below the floor', () => {
    expect(decide({ ...base, margin: margin(999) })).toEqual({
      action: 'hold',
      reason: 'below_floor',
      deadline: '2026-10-22T22:00:00.000Z',
    });
    expect(decide({ ...base, margin: margin(88, 1399) }).action).toBe('hold');
  });

  it('holds a break-even or loss-making order, with no small-loss exception', () => {
    expect(decide({ ...base, margin: margin(0) }).action).toBe('hold');
    expect(decide({ ...base, margin: margin(-100) }).action).toBe('hold');
    expect(decide({ ...base, margin: margin(-501) }).action).toBe('hold');
  });

  it('follows the seller floor: the same margin passes a lower floor', () => {
    expect(decide({ ...base, floorPct: 0.05, margin: margin(600) }).action).toBe('fulfil');
    expect(decide({ ...base, floorPct: 0.2, margin: margin(1500) }).action).toBe('hold');
  });

  it('cancels with no_decision once the deadline has passed', () => {
    expect(decide({ ...base, margin: margin(-501), now: '2026-10-22T22:00:00.000Z' })).toEqual({ action: 'cancel', reason: 'no_decision' });
    expect(decide({ ...base, margin: margin(500), now: '2026-10-25T00:00:00.000Z' })).toEqual({ action: 'cancel', reason: 'no_decision' });
  });

  it('cancels out_of_stock regardless of margin', () => {
    expect(decide({ ...base, margin: margin(5000), stock: 0 })).toEqual({ action: 'cancel', reason: 'out_of_stock' });
    expect(decide({ ...base, margin: margin(-9000), stock: 0 })).toEqual({ action: 'cancel', reason: 'out_of_stock' });
  });

  it('accepts Date objects', () => {
    expect(decide({ ...base, margin: margin(-600), now: new Date(now), orderCreatedAt: new Date(created) }).action).toBe('hold');
  });

  it('rejects invalid dates', () => {
    expect(() => decide({ ...base, margin: margin(-600), now: 'nope' })).toThrow(RangeError);
  });
});
