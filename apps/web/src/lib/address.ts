import type { Address } from '@/api/types';

/** The whole address as it would sit on a parcel. */
export const addressText = (a: Address): string =>
  [a.name, a.line1, a.line2, `${a.city}, ${a.state} ${a.postalCode}`.trim(), a.country].filter((l) => l && l.trim() !== '').join('\n');
