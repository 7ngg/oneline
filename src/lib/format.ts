// Display formatting. Storage is always integer mm/mm²; exports use plain
// '.'-decimal, locale formatting exists only at the UI surface.

import { m2FromMm2, mFromMm, sqftFromMm2, type Mm, type Mm2, MM_PER_FT, MM_PER_IN } from '../engine';
import type { UnitSystem } from '../state/store';

const nf = (digits: number) =>
  new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });

export function formatLength(value: Mm, system: UnitSystem): string {
  if (system === 'imperial') {
    const totalIn = value / MM_PER_IN;
    const ft = Math.floor(totalIn / 12);
    const inches = Math.round(totalIn - ft * 12);
    return inches === 0 ? `${ft}'` : `${ft}'${inches}"`;
  }
  return `${nf(2).format(mFromMm(value))} m`;
}

export function formatArea(value: Mm2, system: UnitSystem): string {
  return system === 'imperial'
    ? `${nf(0).format(sqftFromMm2(value))} sqft`
    : `${nf(1).format(m2FromMm2(value))} m²`;
}

/** Neutral echo of a parsed value — shows the user how input was understood. */
export function echoLength(value: Mm, system: UnitSystem): string {
  return `= ${formatLength(value, system)}`;
}

export function echoArea(value: Mm2, system: UnitSystem): string {
  return `= ${formatArea(value, system)}`;
}

export const formatFt = (valueMm: Mm): string => `${(valueMm / MM_PER_FT).toFixed(1)} ft`;
