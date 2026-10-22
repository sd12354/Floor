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

/**
 * Parse a decimal money string ("12.34", "5", "-0.5", "1.005") into integer cents without any float math.
 * More than two fractional digits round half up (away from zero for negatives) on the decimal digits themselves,
 * so "1.005" -> 101 and "1.004" -> 100. Throws on anything that is not a plain decimal.
 */
export function parseDecimalToCents(value: string): Cents {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new TypeError(`parseDecimalToCents: not a decimal amount: ${JSON.stringify(value)}`);
  const [, sign, whole = '0', fracRaw = ''] = m;
  const frac = fracRaw.padEnd(2, '0');
  let cents = Number(whole) * 100 + Number(frac.slice(0, 2));
  if (frac.length > 2 && (frac.charCodeAt(2) ?? 48) >= 53) cents += 1; // third digit >= '5' rounds up
  if (!Number.isSafeInteger(cents)) throw new RangeError(`parseDecimalToCents: amount too large: ${value}`);
  return sign === '-' ? -cents : cents;
}

/** Integer cents to a plain decimal string for APIs that want one: 1234 -> "12.34", -5 -> "-0.05". */
export function centsToDecimal(cents: Cents): string {
  assertCents(cents, 'cents');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
