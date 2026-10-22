import { meetsFloor } from './margin.js';
import type { LadderDecision, MarginResult, Pct } from './types.js';

export interface LadderInput {
  margin: MarginResult;
  /** The seller's margin floor as a decimal (0.1 = 10%). Orders below it are held, never auto-fulfilled. */
  floorPct: Pct;
  stock: number;
  /** Current time (ISO string or Date). Used to decide whether a hold has already expired. */
  now: Date | string;
  /** When the eBay order was created. The hold deadline is derived from it. */
  orderCreatedAt: Date | string;
  /** Account handling time in days; deadline = createdAt + handlingTimeDays*24h - 12h. */
  handlingTimeDays: number;
}

const HOUR_MS = 60 * 60 * 1000;

function toDate(d: Date | string): Date {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(d)}`);
  return date;
}

/** Hold deadline per CONTRACT.md: createdAt + handlingTimeDays*24h - 12h. */
export function holdDeadline(orderCreatedAt: Date | string, handlingTimeDays: number): Date {
  const created = toDate(orderCreatedAt);
  return new Date(created.getTime() + handlingTimeDays * 24 * HOUR_MS - 12 * HOUR_MS);
}

/**
 * Post-sale ladder, evaluated once the supplier price/stock has been re-fetched:
 *
 *   stock 0                                   -> cancel (out_of_stock)
 *   netMarginPct >= floorPct                  -> fulfil (within_tolerance)
 *   deadline already passed                   -> cancel (no_decision)
 *   otherwise                                 -> hold (below_floor) until deadline
 *
 * Floor never fulfils on its own below the seller's margin floor, not even at a small profit.
 * The 'small_loss' reason is no longer produced; it stays in the type so old orders still render.
 */
export function decide(input: LadderInput): LadderDecision {
  if (input.stock <= 0) return { action: 'cancel', reason: 'out_of_stock' };
  if (meetsFloor(input.margin, input.floorPct)) return { action: 'fulfil', reason: 'within_tolerance' };
  const deadline = holdDeadline(input.orderCreatedAt, input.handlingTimeDays);
  if (toDate(input.now).getTime() >= deadline.getTime()) {
    return { action: 'cancel', reason: 'no_decision' };
  }
  return { action: 'hold', reason: 'below_floor', deadline: deadline.toISOString() };
}
