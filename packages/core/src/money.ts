import type { Cents } from './types.js';

/** Round half up to the nearest integer (cents). Negative values round symmetrically away from zero at .5. */
export function roundHalfUp(value: number): Cents {
  if (!Number.isFinite(value)) throw new RangeError(`roundHalfUp: non-finite value ${value}`);
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5);
}

/** Assert a value is an integer number of cents. */
export function assertCents(value: number, label = 'value'): Cents {
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be integer cents, got ${value}`);
  return value;
}

/** Format integer cents as a dollar string, e.g. 1234 -> "$12.34". */
export function formatCents(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Percent of cents, rounded half up. */
export function pctOf(cents: Cents, pct: number): Cents {
  return roundHalfUp(cents * pct);
}
