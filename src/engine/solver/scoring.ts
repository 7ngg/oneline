// All score terms and weights in one place. Every term is normalized to
// [0, 1]; the total is the weighted mean. Non-finite guard: score() returns
// null for any candidate that produces a non-finite term — callers count
// these as a bug canary (SOLVER_NONFINITE_SCORES).

import { area2OfPoly } from '../geometry/clip';
import { sharedBoundaryLength } from '../geometry/measure';
import { polyBoundaryLength, ringBbox, type Poly } from '../geometry/polygon';
import { ROOM_TYPE_DEFAULTS } from '../program/defaults';
import { DOOR_MIN_WIDTH, type AdjacencyRule, type RoomSpec } from '../program/types';

export const SCORE_WEIGHTS = {
  areaFit: 3,
  adjacency: 2.5,
  minDim: 2,
  aspect: 1.5,
  exposure: 1.5,
  orientation: 0.75,
  compactness: 0.75,
} as const;

export interface ScoredTerms {
  areaFit: number;
  adjacency: number;
  minDim: number;
  aspect: number;
  exposure: number;
  orientation: number;
  compactness: number;
  total: number;
}

export interface ScoreInput {
  rooms: RoomSpec[];
  cells: (Poly | null)[]; // room index → cell
  adjacency: AdjacencyRule[];
  footprint: Poly;
}

export function score(input: ScoreInput): ScoredTerms | null {
  const { rooms, cells, adjacency, footprint } = input;
  if (rooms.length === 0) return null;

  const bb = ringBbox(footprint.outer);
  const midX = (bb.minX + bb.maxX) / 2;
  const midY = (bb.minY + bb.maxY) / 2;

  let areaFit = 0;
  let minDimTerm = 0;
  let aspect = 0;
  let compactness = 0;
  let exposureNeed = 0;
  let exposureMet = 0;
  let orientationNeed = 0;
  let orientationMet = 0;

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i] as RoomSpec;
    const cell = cells[i];
    if (!cell) return { ...zeroTerms(), total: 0 };
    const gross = area2OfPoly(cell) / 2;
    const ideal = room.area.ideal;
    let fit = Math.max(0, 1 - Math.abs(gross - ideal) / ideal);
    if (gross < room.area.min || gross > room.area.max * 1.15) fit = 0;
    areaFit += fit;

    const cb = ringBbox(cell.outer);
    const w = cb.maxX - cb.minX;
    const h = cb.maxY - cb.minY;
    const minSide = Math.min(w, h);
    const ratio = minSide > 0 ? Math.max(w, h) / minSide : Infinity;
    aspect += Number.isFinite(ratio) ? Math.max(0, Math.min(1, (3.2 - ratio) / 2.2)) : 0;
    minDimTerm += minSide >= room.minDim ? 1 : Math.max(0, minSide / room.minDim - 0.25);

    const perimeter = polyBoundaryLength(cell);
    const compact = perimeter > 0 ? (4 * Math.sqrt(area2OfPoly(cell) / 2)) / perimeter : 0;
    compactness += Math.max(0, Math.min(1, compact));

    const wantsExposure = room.prefs.exteriorWall ?? ROOM_TYPE_DEFAULTS[room.type].needsDaylight;
    if (wantsExposure) {
      exposureNeed += 1;
      if (sharedBoundaryLength(cell, footprint) >= 1_000) exposureMet += 1;
    }
    if (room.prefs.orientation) {
      orientationNeed += 1;
      const cx = (cb.minX + cb.maxX) / 2;
      const cy = (cb.minY + cb.maxY) / 2;
      const match =
        (room.prefs.orientation === 'N' && cy > midY) ||
        (room.prefs.orientation === 'S' && cy < midY) ||
        (room.prefs.orientation === 'E' && cx > midX) ||
        (room.prefs.orientation === 'W' && cx < midX);
      if (match) orientationMet += 1;
    }
  }

  let adjacencyWeight = 0;
  let adjacencySatisfied = 0;
  const cellOf = new Map(rooms.map((r, i) => [r.id, cells[i] ?? null]));
  for (const rule of adjacency) {
    const a = cellOf.get(rule.a);
    const b = cellOf.get(rule.b);
    if (!a || !b) continue;
    const shared = sharedBoundaryLength(a, b);
    const touching = shared >= DOOR_MIN_WIDTH;
    const w = rule.weight * (rule.kind === 'required' ? 2 : 1);
    adjacencyWeight += w;
    if (rule.kind === 'avoid' ? !touching : touching) adjacencySatisfied += w;
  }

  const n = rooms.length;
  const terms: ScoredTerms = {
    areaFit: areaFit / n,
    adjacency: adjacencyWeight > 0 ? adjacencySatisfied / adjacencyWeight : 1,
    minDim: minDimTerm / n,
    aspect: aspect / n,
    exposure: exposureNeed > 0 ? exposureMet / exposureNeed : 1,
    orientation: orientationNeed > 0 ? orientationMet / orientationNeed : 1,
    compactness: compactness / n,
    total: 0,
  };

  let weighted = 0;
  let weightSum = 0;
  for (const key of Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]) {
    const term = terms[key];
    if (!Number.isFinite(term)) return null;
    weighted += term * SCORE_WEIGHTS[key];
    weightSum += SCORE_WEIGHTS[key];
  }
  terms.total = weighted / weightSum;
  return Number.isFinite(terms.total) ? terms : null;
}

const zeroTerms = (): Omit<ScoredTerms, 'total'> => ({
  areaFit: 0,
  adjacency: 0,
  minDim: 0,
  aspect: 0,
  exposure: 0,
  orientation: 0,
  compactness: 0,
});
