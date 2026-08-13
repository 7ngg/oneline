// The ONLY file that touches clipper2-ts. Everything speaks Ring/Poly in
// integer mm; conversions round on the way out so no float ever leaks.
// Orientation convention matches ours: outers CCW (positive), holes CW.

import { Clipper, EndType, FillRule, JoinType, type Path64, type Paths64 } from 'clipper2-ts';
import { mm, type Mm } from '../units';
import {
  isCCW,
  normalizeRing,
  pointInRing,
  signedArea2,
  type Poly,
  type Ring,
} from './polygon';
import type { Vec } from './vec';

const ringToPath = (ring: Ring): Path64 => ring.map((p) => ({ x: p.x, y: p.y }));

const pathToRing = (path: Path64): Ring => path.map((p) => ({ x: mm(p.x), y: mm(p.y) }));

export const polyToPaths = (p: Poly): Paths64 => [
  ringToPath(p.outer),
  ...p.holes.map((h) => ringToPath(h)),
];

/**
 * Reassemble a clipper result into Polys: positive rings become outers,
 * negative rings become holes of the outer that contains them. Degenerate
 * rings are dropped via normalizeRing.
 */
export function pathsToPolys(paths: Paths64): Poly[] {
  const outers: Array<{ ring: Ring; holes: Ring[] }> = [];
  const holes: Ring[] = [];
  for (const path of paths) {
    const raw = pathToRing(path);
    if (raw.length < 3) continue;
    const positive = signedArea2(raw) > 0;
    const norm = normalizeRing(raw);
    if (!norm) continue;
    if (positive) {
      outers.push({ ring: norm, holes: [] });
    } else {
      norm.reverse(); // keep holes CW
      holes.push(norm);
    }
  }
  for (const hole of holes) {
    const probe = hole[0] as Vec;
    const host = outers.find((o) => pointInRing(probe, o.ring) !== 'outside');
    host?.holes.push(hole);
  }
  return outers.map((o) => ({ outer: o.ring, holes: o.holes }));
}

const holesAsClipper = (p: Poly): Paths64 =>
  polyToPaths({
    outer: p.outer,
    // our holes are CW already, which clipper reads as negative — correct
    holes: p.holes,
  });

export function intersectPolys(a: Poly, b: Poly): Poly[] {
  return pathsToPolys(Clipper.intersect(holesAsClipper(a), holesAsClipper(b), FillRule.NonZero));
}

export function subtractPolys(a: Poly, b: Poly): Poly[] {
  return pathsToPolys(Clipper.difference(holesAsClipper(a), holesAsClipper(b), FillRule.NonZero));
}

export function unionPolys(list: Poly[]): Poly[] {
  if (list.length === 0) return [];
  const subject: Paths64 = list.flatMap((p) => holesAsClipper(p));
  return pathsToPolys(Clipper.union(subject, FillRule.NonZero));
}

/**
 * Offset a poly by delta (positive = outward, negative = inward/shrink).
 * Miter joins keep architectural corners sharp. May return zero polys
 * (setback collapse) or several (concave shapes pinching apart).
 */
export function offsetPoly(p: Poly, delta: Mm): Poly[] {
  const result = Clipper.inflatePaths(holesAsClipper(p), delta, JoinType.Miter, EndType.Polygon, 2);
  return pathsToPolys(result);
}

/** True when the poly still has interior after eroding by `r` on all sides. */
export function erosionSurvives(p: Poly, r: Mm): boolean {
  if (r <= 0) return true;
  return offsetPoly(p, mm(-r) as Mm).length > 0;
}

/** Exact doubled intersection area of two polys. */
export function intersectionArea2(a: Poly, b: Poly): number {
  let s = 0;
  for (const p of intersectPolys(a, b)) {
    s += area2OfPoly(p);
  }
  return s;
}

export function area2OfPoly(p: Poly): number {
  let s = Math.abs(signedArea2(p.outer));
  for (const h of p.holes) s -= Math.abs(signedArea2(h));
  return s;
}

/**
 * Cut a footprint into cells, one per rect (rects are expected to tile the
 * footprint's bbox). Tessellation exactness contract:
 * - RECTILINEAR footprint + axis-aligned cuts: every crossing is a lattice
 *   point, clipper introduces no rounding, and the cells tile the footprint
 *   EXACTLY (Σ area2(cells) === area2(footprint), pairwise overlaps 0).
 * - Diagonal footprint edges: each rounded crossing can displace the boundary
 *   by ≤ ~0.7 mm, so the identity holds within a sub-mm "skin" bounded by
 *   tessellationToleranceArea2. True exactness with diagonals would need a
 *   snap-rounded arrangement engine — deliberately out of scope; the repair
 *   stage absorbs any sub-tolerance slivers instead.
 */
export function cellsForRects(footprint: Poly, rects: Ring[]): Poly[][] {
  return rects.map((r) => intersectPolys(footprint, { outer: r, holes: [] }));
}

/**
 * Doubled-area tolerance for tessellation identities on non-rectilinear
 * footprints: a 1 mm skin along all boundary + cut length, doubled for
 * safety. Astronomically below any real room area (~1e7 area2 units).
 */
export function tessellationToleranceArea2(boundaryLengthMm: number): number {
  return Math.ceil(boundaryLengthMm) * 4;
}

/** True when every edge of the ring is axis-parallel. */
export function isRectilinear(ring: Ring): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec;
    const b = ring[(i + 1) % ring.length] as Vec;
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  return true;
}

/** Largest-area poly of a set (used when setbacks split a footprint). */
export function largestPoly(polys: Poly[]): Poly | null {
  let best: Poly | null = null;
  let bestArea = -1;
  for (const p of polys) {
    const a = area2OfPoly(p);
    if (a > bestArea) {
      bestArea = a;
      best = p;
    }
  }
  return best;
}

// re-export for tests that want to assert on raw clipper behaviour
export { isCCW };
