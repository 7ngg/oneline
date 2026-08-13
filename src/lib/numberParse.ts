// Locale- and unit-aware numeric input parsing. Never silently returns 0:
// unparsable input yields an error, and the caller echoes the interpretation
// back ("= 3.50 m²") so comma-decimal heuristics stay transparent.

import {
  mm,
  mm2,
  MM2_PER_M2,
  MM2_PER_SQFT,
  MM_PER_FT,
  MM_PER_IN,
  MM_PER_M,
  type Mm,
  type Mm2,
} from '../engine';
import type { UnitSystem } from '../state/store';

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; error: string };

const NBSP = /[  \s]/g;

/**
 * Decimal-separator heuristic:
 * - both '.' and ',' present → the rightmost one is the decimal separator
 * - only ',' → decimal unless it appears more than once (then grouping)
 * - only '.' → decimal unless it appears more than once (then grouping)
 * A single separator followed by exactly 3 digits stays DECIMAL (EU habit;
 * the UI echo shows the interpretation so US-style "1,500" is caught by eye).
 */
export function parseDecimal(rawInput: string): number | null {
  let raw = rawInput.replace(NBSP, '');
  if (!raw) return null;
  let sign = 1;
  if (raw.startsWith('-')) {
    sign = -1;
    raw = raw.slice(1);
  }
  if (!/^[\d.,]+$/.test(raw)) return null;
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  let decimalSep: '.' | ',' | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? '.' : ',';
    // the decimal separator must be unique; "1.2.3,4,5" is noise, not a number
    if (raw.split(decimalSep).length !== 2) return null;
  } else if (lastComma >= 0) {
    decimalSep = raw.indexOf(',') === lastComma ? ',' : null;
  } else if (lastDot >= 0) {
    decimalSep = raw.indexOf('.') === lastDot ? '.' : null;
  }
  let intPart = raw;
  let fracPart = '';
  if (decimalSep) {
    const idx = raw.lastIndexOf(decimalSep);
    intPart = raw.slice(0, idx);
    fracPart = raw.slice(idx + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;
  const value = Number(`${intPart || '0'}.${fracPart || '0'}`);
  return Number.isFinite(value) ? sign * value : null;
}

interface UnitDef {
  toMm: number;
  kind: 'length' | 'area';
}

const UNITS: Record<string, UnitDef> = {
  mm: { toMm: 1, kind: 'length' },
  cm: { toMm: 10, kind: 'length' },
  m: { toMm: MM_PER_M, kind: 'length' },
  km: { toMm: 1_000_000, kind: 'length' },
  ft: { toMm: MM_PER_FT, kind: 'length' },
  "'": { toMm: MM_PER_FT, kind: 'length' },
  in: { toMm: MM_PER_IN, kind: 'length' },
  '"': { toMm: MM_PER_IN, kind: 'length' },
  m2: { toMm: MM2_PER_M2, kind: 'area' },
  'm²': { toMm: MM2_PER_M2, kind: 'area' },
  sqm: { toMm: MM2_PER_M2, kind: 'area' },
  sqft: { toMm: MM2_PER_SQFT, kind: 'area' },
  ft2: { toMm: MM2_PER_SQFT, kind: 'area' },
  'ft²': { toMm: MM2_PER_SQFT, kind: 'area' },
};

interface Token {
  value: number;
  unit: string | null;
}

/** Tokenize "3m 20cm", "12'6\"", "350 sqft" into value+unit pairs. */
function tokenize(input: string): Token[] | null {
  const compact = input.trim().toLowerCase().replace(NBSP, ' ');
  const re = /([\d.,]+)\s*(m²|ft²|m2|ft2|sqft|sqm|mm|cm|km|m|ft|in|'|")?/gy;
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < compact.length) {
    if (compact[pos] === ' ') {
      pos++;
      continue;
    }
    re.lastIndex = pos;
    const match = re.exec(compact);
    if (!match || match.index !== pos) return null;
    const value = parseDecimal(match[1] as string);
    if (value === null) return null;
    tokens.push({ value, unit: match[2] ?? null });
    pos = re.lastIndex;
  }
  return tokens.length > 0 ? tokens : null;
}

const defaultLengthUnit = (system: UnitSystem): string => (system === 'metric' ? 'm' : 'ft');
const defaultAreaUnit = (system: UnitSystem): string => (system === 'metric' ? 'm2' : 'sqft');

/** Follow-up unit when a bare number trails a unit: 3m 20 → cm; 12' 6 → in. */
const followUpUnit: Record<string, string | undefined> = {
  m: 'cm',
  "'": '"',
  ft: 'in',
};

export function parseLength(input: string, system: UnitSystem): ParseOk<Mm> | ParseErr {
  const tokens = tokenize(input);
  if (!tokens) return { ok: false, error: 'Enter a length like "3.5 m", "3m 20", or "12\'6\"".' };
  let total = 0;
  let prevUnit: string | null = null;
  for (const [i, token] of tokens.entries()) {
    let unitKey = token.unit;
    if (!unitKey) {
      unitKey = i === 0 ? defaultLengthUnit(system) : (followUpUnit[prevUnit ?? ''] ?? null);
      if (!unitKey) return { ok: false, error: `Missing unit after "${token.value}".` };
    }
    const unit = UNITS[unitKey];
    if (!unit || unit.kind !== 'length') return { ok: false, error: `"${unitKey}" is not a length unit.` };
    total += token.value * unit.toMm;
    prevUnit = unitKey;
  }
  if (!Number.isFinite(total)) return { ok: false, error: 'That number is too large.' };
  return { ok: true, value: mm(total) };
}

export function parseArea(input: string, system: UnitSystem): ParseOk<Mm2> | ParseErr {
  const tokens = tokenize(input);
  if (!tokens || tokens.length !== 1) {
    return { ok: false, error: 'Enter an area like "12.5", "12,5 m²" or "350 sqft".' };
  }
  const token = tokens[0] as Token;
  const unitKey = token.unit ?? defaultAreaUnit(system);
  const unit = UNITS[unitKey];
  if (!unit || unit.kind !== 'area') return { ok: false, error: `"${unitKey}" is not an area unit.` };
  const total = token.value * unit.toMm;
  if (!Number.isFinite(total)) return { ok: false, error: 'That number is too large.' };
  return { ok: true, value: mm2(total) };
}
