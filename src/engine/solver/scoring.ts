// All score terms and weights in one place. Every term is normalized to
// [0, 1]; the total is the weighted mean. Non-finite guard: score() returns
// null for any candidate that produces a non-finite term — callers count
// these as a bug canary (SOLVER_NONFINITE_SCORES).

import { area2OfPoly } from '../geometry/clip';
import { sharedBoundaryLength } from '../geometry/measure';
import { polyBoundaryLength, ringBbox, type Poly } from '../geometry/polygon';
import type { Vec } from '../geometry/vec';
import { touchRate } from '../priors/priors';
import { ROOM_TYPE_DEFAULTS } from '../program/defaults';
import { DOOR_MIN_WIDTH, type AdjacencyRule, type RoomSpec, type RoomType } from '../program/types';

export const SCORE_WEIGHTS = {
  areaFit: 3.5,
  adjacency: 2.5,
  minDim: 2,
  treeFit: 2,
  circulation: 2, // strict B01/K02 hub metric deserves real pull

  aspect: 1.5,
  exposure: 1.5,
  typicality: 1.5,
  wetCluster: 0.75,
  entrance: 0.75,
  orientation: 0.75,
  compactness: 0.75,
} as const;

export interface ScoredTerms {
  areaFit: number;
  adjacency: number;
  minDim: number;
  treeFit: number;
  circulation: number;
  aspect: number;
  exposure: number;
  typicality: number;
  wetCluster: number;
  entrance: number;
  orientation: number;
  compactness: number;
  total: number;
}

export interface ScoreInput {
  rooms: RoomSpec[];
  cells: (Poly | null)[]; // room index → cell
  adjacency: AdjacencyRule[];
  footprint: Poly;
  /** Entrance hint on the plot boundary (world mm), when the user set one. */
  entrance?: Vec;
  /**
   * Topology-first candidates: access-tree edges (parent room index, child
   * room index) this layout is supposed to realize as door-able walls.
   * Neutral (1) when absent.
   */
  targetPairs?: Array<[number, number]>;
}

// Bathrooms/WCs stack on shared plumbing walls. Kitchens deliberately NOT
// included: ResPlan shows kitchen|bathroom adjacency in only 33% of real
// flats — the typicality term handles that pair from data instead.
const WET_TYPES = new Set<RoomType>(['bathroom', 'wc']);
/** Target exterior glazing run for a daylight room (graded, not binary). */
const EXPOSURE_TARGET = 1_800;
const WET_SHARE_MIN = 300;

/**
 * Area elasticity: when a plot has surplus area, WHO absorbs it. Stiff types
 * (bathrooms, storage) go steeply negative past their max so the annealer
 * actively shrinks them; elastic types (living, bedrooms) absorb overshoot
 * almost free. Fixes "19 m² bathroom because the L-plot had leftovers".
 */
const STIFFNESS: Record<RoomType, number> = {
  bathroom: 3,
  wc: 3,
  storage: 2.5,
  kitchen: 1.2, // A02 tier 1: kitchens absorb surplus before private rooms
  hall: 1.5,
  bedroom: 0.8,
  balcony: 1,
  other: 0.75,
  living: 0.4,
};

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
    const stiffness = STIFFNESS[room.type];
    let fit: number;
    if (gross < room.area.min) {
      // below minimum: negative, scaled by how stiff the type is
      fit = Math.max(-1.5, (gross / room.area.min - 1) * 2 * stiffness);
    } else if (gross > room.area.max) {
      // above maximum: elastic rooms barely mind, stiff rooms punished hard —
      // this gradient is what steers surplus into living/bedrooms
      fit = Math.max(-1.5, -((gross - room.area.max) / ideal) * stiffness);
    } else {
      fit = Math.max(0, 1 - Math.abs(gross - ideal) / ideal);
    }
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
      // graded: full credit at EXPOSURE_TARGET mm of exterior contact
      exposureMet += Math.min(1, sharedBoundaryLength(cell, footprint) / EXPOSURE_TARGET);
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

  // --- circulation: every room needs a door-able wall to a circulation HUB.
  // Which hubs count is design_rules_v4's B01/K02: when the program HAS a
  // hall, bedrooms, bathrooms, WCs and the kitchen must reach the HALL —
  // reaching them through the living room is the walk-through-a-habitable-
  // room defect (B01 NORM). Without a hall the living room IS the
  // circulation (K02's else-branch) and counts for every room. Storage and
  // balconies may hang off either hub (or a bedroom — ensuite/wardrobe),
  // so they keep the relaxed hub set. Neutral without hubs.
  const hallCells: Poly[] = [];
  const livingCells: Poly[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const type = (rooms[i] as RoomSpec).type;
    const cell = cells[i];
    if (!cell) continue;
    if (type === 'hall') hallCells.push(cell);
    else if (type === 'living') livingCells.push(cell);
  }
  const STRICT_HUB_TYPES = new Set<RoomType>(['bedroom', 'bathroom', 'wc', 'kitchen']);
  let circulation = 1;
  if (hallCells.length + livingCells.length > 0) {
    const relaxedHubs = hallCells.concat(livingCells); // hot loop: build once
    let reached = 0;
    let nonHub = 0;
    for (let i = 0; i < rooms.length; i++) {
      const type = (rooms[i] as RoomSpec).type;
      if (type === 'hall' || type === 'living') continue;
      nonHub += 1;
      const cell = cells[i];
      if (!cell) continue;
      const hubs = hallCells.length > 0 && STRICT_HUB_TYPES.has(type) ? hallCells : relaxedHubs;
      // must match the door router's requirement (width + jambs), not bare
      // adjacency — a 750 mm shared wall "touches" but can't hold a door
      if (hubs.some((hub) => sharedBoundaryLength(cell, hub) >= DOOR_MIN_WIDTH + 200)) reached += 1;
    }
    circulation = nonHub > 0 ? reached / nonHub : 1;
  }

  // --- treeFit: fraction of the candidate's target access-tree edges that
  // are realized as door-able shared walls. Neutral without a target tree.
  let treeFit = 1;
  if (input.targetPairs && input.targetPairs.length > 0) {
    let realized = 0;
    for (const [p, c] of input.targetPairs) {
      const a = cells[p];
      const b = cells[c];
      if (a && b && sharedBoundaryLength(a, b) >= DOOR_MIN_WIDTH + 200) realized += 1;
    }
    treeFit = realized / input.targetPairs.length;
  }

  // --- wet cluster: kitchens/bathrooms/wcs share walls (plumbing stacks).
  // Fraction of wet rooms touching at least one other wet room; neutral with
  // fewer than two wet rooms.
  const wetIdx: number[] = [];
  for (let i = 0; i < rooms.length; i++) {
    if (WET_TYPES.has((rooms[i] as RoomSpec).type)) wetIdx.push(i);
  }
  let wetCluster = 1;
  if (wetIdx.length >= 2) {
    let clustered = 0;
    for (const i of wetIdx) {
      const a = cells[i];
      if (!a) continue;
      const touches = wetIdx.some((j) => {
        if (j === i) return false;
        const b = cells[j];
        return b !== null && b !== undefined && sharedBoundaryLength(a, b) >= WET_SHARE_MIN;
      });
      if (touches) clustered += 1;
    }
    wetCluster = clustered / wetIdx.length;
  }

  // --- typicality: does this arrangement look like real flats? For every
  // typed room pair with ResPlan data, score the touch/no-touch state by how
  // often real plans agree. Confidence-weighted: a 98% pair counts harder
  // than a 50/50 pair. Neutral without data.
  let typicalityScore = 0;
  let typicalityWeight = 0;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const rate = touchRate((rooms[i] as RoomSpec).type, (rooms[j] as RoomSpec).type);
      if (rate === null) continue;
      const a = cells[i];
      const b = cells[j];
      if (!a || !b) continue;
      const touching = sharedBoundaryLength(a, b) >= DOOR_MIN_WIDTH;
      const confidence = Math.abs(2 * rate - 1);
      if (confidence < 0.2) continue; // 50/50 pairs teach nothing
      typicalityScore += (touching ? rate : 1 - rate) * confidence;
      typicalityWeight += confidence;
    }
  }
  const typicality = typicalityWeight > 0 ? typicalityScore / typicalityWeight : 1;

  // --- entrance anchoring: some hall (or nearEntrance room) should sit at
  // the entrance. Distance from the entrance point to the nearest such room,
  // full credit within 1.5 m, fading to 0 by 6.5 m. Neutral without an
  // entrance hint or anchor-seeking rooms.
  let entrance = 1;
  if (input.entrance) {
    const anchors: Poly[] = [];
    for (let i = 0; i < rooms.length; i++) {
      const room = rooms[i] as RoomSpec;
      if (room.type === 'hall' || room.prefs.nearEntrance) {
        const cell = cells[i];
        if (cell) anchors.push(cell);
      }
    }
    if (anchors.length > 0) {
      const d = Math.min(...anchors.map((cell) => distanceToPoly(input.entrance as Vec, cell)));
      entrance = Math.max(0, Math.min(1, 1 - (d - 1_500) / 5_000));
    }
  }

  const n = rooms.length;
  const terms: ScoredTerms = {
    areaFit: areaFit / n,
    adjacency: adjacencyWeight > 0 ? adjacencySatisfied / adjacencyWeight : 1,
    minDim: minDimTerm / n,
    treeFit,
    circulation,
    aspect: aspect / n,
    exposure: exposureNeed > 0 ? exposureMet / exposureNeed : 1,
    typicality,
    wetCluster,
    entrance,
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
  // areaFit can go negative now (elasticity gradient); keep total displayable
  terms.total = Math.max(0, weighted / weightSum);
  return Number.isFinite(terms.total) ? terms : null;
}

/** Distance from a point to a polygon boundary (0 when inside). */
function distanceToPoly(p: Vec, poly: Poly): number {
  const ring = poly.outer;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec;
    const b = ring[(i + 1) % ring.length] as Vec;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    let t = 0;
    if (len2 > 0) {
      t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    }
    const qx = a.x + (b.x - a.x) * t;
    const qy = a.y + (b.y - a.y) * t;
    best = Math.min(best, Math.hypot(p.x - qx, p.y - qy));
  }
  return best;
}

const zeroTerms = (): Omit<ScoredTerms, 'total'> => ({
  areaFit: 0,
  adjacency: 0,
  minDim: 0,
  treeFit: 0,
  circulation: 0,
  aspect: 0,
  exposure: 0,
  typicality: 0,
  wetCluster: 0,
  entrance: 0,
  orientation: 0,
  compactness: 0,
});
