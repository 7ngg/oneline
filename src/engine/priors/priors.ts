// Statistical priors derived offline from ResPlan (CC BY 4.0) — see the JSON
// for provenance. This module maps our room taxonomy onto ResPlan's and
// answers "how typical is this?" questions for scoring and candidate gates.
// ResPlan has no separate hall type: circulation is merged into "living",
// which is also why our halls map there for adjacency purposes.

import raw from './resplanPriors.json';
import type { RoomType } from '../program/types';

type ResplanType = 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'balcony';

const TYPE_MAP: Record<RoomType, ResplanType | null> = {
  living: 'living',
  hall: 'living', // circulation lives inside "living" in ResPlan's taxonomy
  kitchen: 'kitchen',
  bedroom: 'bedroom',
  bathroom: 'bathroom',
  wc: 'bathroom',
  balcony: 'balcony',
  storage: null,
  other: null,
};

const pairKey = (a: ResplanType, b: ResplanType): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * P(two rooms of these types share a wall | both present in a real flat).
 * null when we have no data for the pair (unknown types, or hall↔living
 * which is an artifact of the taxonomy merge, or same-type pairs).
 */
export function touchRate(a: RoomType, b: RoomType): number | null {
  const ra = TYPE_MAP[a];
  const rb = TYPE_MAP[b];
  if (!ra || !rb || ra === rb) return null;
  const rate = (raw.pairTouchRate as Record<string, number>)[pairKey(ra, rb)];
  return rate ?? null;
}

/**
 * Per-type hard aspect cap for candidate rejection: the p98 of real rooms of
 * that type with 25% headroom. Halls/corridors are exempt (long is their
 * job); unknown types get a generous default.
 */
export function aspectCapFor(type: RoomType): number {
  if (type === 'hall') return 8;
  const mapped = TYPE_MAP[type];
  if (!mapped) return 3.5;
  const p98 = (raw.types as Record<string, { aspectP98: number }>)[mapped]?.aspectP98;
  return p98 ? p98 * 1.25 : 3.5;
}

/** Median share of the flat's area this type occupies in real plans. */
export function typicalShareOfFlat(type: RoomType): number | null {
  const mapped = TYPE_MAP[type];
  if (!mapped) return null;
  return (raw.types as Record<string, { shareOfFlat: number }>)[mapped]?.shareOfFlat ?? null;
}

export const PRIORS_SOURCE = raw.source;
export const PRIOR_WALL_DEPTH_M = raw.wallDepthM;
