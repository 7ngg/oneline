// Ring/Poly types and exact integer polygon predicates.
// Ring: implicitly closed, no repeated last vertex. Outer rings CCW, holes CW
// (mathematical +Y-up convention) — enforced by normalizeRing.

import { mm2, type Mm, type Mm2 } from '../units';
import { cross, onSegment, orient, segmentsIntersect, vEq, type Vec } from './vec';

export type Ring = Vec[];

export interface Poly {
  outer: Ring;
  holes: Ring[];
}

export const poly = (outer: Ring, holes: Ring[] = []): Poly => ({ outer, holes });

/** Twice the signed area — exact integer. Positive = CCW. */
export function signedArea2(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec;
    const b = ring[(i + 1) % ring.length] as Vec;
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/** Twice the absolute area — exact integer. Use for exact comparisons. */
export const area2 = (ring: Ring): number => Math.abs(signedArea2(ring));

/** Twice the area of a poly with holes — exact integer. */
export const polyArea2 = (p: Poly): number =>
  area2(p.outer) - p.holes.reduce((s, h) => s + area2(h), 0);

/** Rounded Mm² for display/metrics; comparisons should use area2/polyArea2. */
export const ringAreaMm2 = (ring: Ring): Mm2 => mm2(area2(ring) / 2);
export const polyAreaMm2 = (p: Poly): Mm2 => mm2(polyArea2(p) / 2);

export const isCCW = (ring: Ring): boolean => signedArea2(ring) > 0;

/** Drop consecutive duplicate vertices, including the wrap-around pair. */
export function dedupeConsecutive(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    if (out.length === 0 || !vEq(out[out.length - 1] as Vec, p)) out.push(p);
  }
  while (out.length > 1 && vEq(out[0] as Vec, out[out.length - 1] as Vec)) out.pop();
  return out;
}

/**
 * Canonicalize a ring: drop consecutive duplicates and collinear/spike
 * vertices (iterated to a fixed point), force CCW winding.
 * Returns null when fewer than 3 vertices or zero area remain.
 */
export function normalizeRing(input: Ring): Ring | null {
  let ring = input.slice();
  let changed = true;
  while (changed) {
    changed = false;
    // consecutive duplicates (including wrap-around)
    const dedup: Ring = [];
    for (const p of ring) {
      if (dedup.length === 0 || !vEq(dedup[dedup.length - 1] as Vec, p)) dedup.push(p);
    }
    while (dedup.length > 1 && vEq(dedup[0] as Vec, dedup[dedup.length - 1] as Vec)) dedup.pop();
    if (dedup.length !== ring.length) changed = true;
    ring = dedup;
    if (ring.length < 3) return null;
    // collinear vertices and spikes: prev→cur→next with zero cross
    const out: Ring = [];
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i + ring.length - 1) % ring.length] as Vec;
      const cur = ring[i] as Vec;
      const next = ring[(i + 1) % ring.length] as Vec;
      if (cross(prev, cur, next) === 0) {
        changed = true;
        continue;
      }
      out.push(cur);
    }
    ring = out;
    if (ring.length < 3) return null;
  }
  if (signedArea2(ring) === 0) return null;
  if (!isCCW(ring)) ring.reverse();
  return ring;
}

/**
 * Exact simplicity test, O(n²): no two non-adjacent edges may touch, and
 * adjacent edges may share only their common endpoint.
 */
export function isSimpleRing(ring: Ring): boolean {
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i] as Vec;
    const a2 = ring[(i + 1) % n] as Vec;
    for (let j = i + 1; j < n; j++) {
      const b1 = ring[j] as Vec;
      const b2 = ring[(j + 1) % n] as Vec;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // shared endpoint allowed; anything more (collinear overlap) is not
        const shared = j === i + 1 ? a2 : a1;
        const otherA = j === i + 1 ? a1 : a2;
        const otherB = j === i + 1 ? b2 : b1;
        if (onSegment(b1, b2, otherA) && !vEq(otherA, shared)) return false;
        if (onSegment(a1, a2, otherB) && !vEq(otherB, shared)) return false;
      } else if (segmentsIntersect(a1, a2, b1, b2)) {
        return false;
      }
    }
  }
  return true;
}

/** Segment pairs of a ring that intersect illegally — for UI highlighting. */
export function selfIntersections(ring: Ring): Array<[number, number]> {
  const bad: Array<[number, number]> = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (
        segmentsIntersect(
          ring[i] as Vec,
          ring[(i + 1) % n] as Vec,
          ring[j] as Vec,
          ring[(j + 1) % n] as Vec,
        )
      ) {
        bad.push([i, j]);
      }
    }
  }
  return bad;
}

export type PointLocation = 'inside' | 'outside' | 'boundary';

/** Exact point-in-ring via crossing counting with boundary detection. */
export function pointInRing(p: Vec, ring: Ring): PointLocation {
  const n = ring.length;
  let inside = false;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Vec;
    const b = ring[(i + 1) % n] as Vec;
    if (onSegment(a, b, p)) return 'boundary';
    const aAbove = a.y > p.y;
    const bAbove = b.y > p.y;
    if (aAbove !== bAbove) {
      const side = orient(a, b, p);
      // edge goes upward: p must be left; downward: right — exact raycast
      if (b.y > a.y ? side > 0 : side < 0) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

export function pointInPoly(p: Vec, pol: Poly): PointLocation {
  const outer = pointInRing(p, pol.outer);
  if (outer !== 'inside') return outer;
  for (const h of pol.holes) {
    const inHole = pointInRing(p, h);
    if (inHole === 'boundary') return 'boundary';
    if (inHole === 'inside') return 'outside';
  }
  return 'inside';
}

export function ringPerimeter(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Vec;
    const b = ring[(i + 1) % ring.length] as Vec;
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

export const polyBoundaryLength = (p: Poly): number =>
  ringPerimeter(p.outer) + p.holes.reduce((s, h) => s + ringPerimeter(h), 0);

export interface Bbox {
  minX: Mm;
  minY: Mm;
  maxX: Mm;
  maxY: Mm;
}

export function ringBbox(ring: Ring): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX as Mm, minY: minY as Mm, maxX: maxX as Mm, maxY: maxY as Mm };
}

export const bboxSpan = (b: Bbox): { w: Mm; h: Mm } => ({
  w: (b.maxX - b.minX) as Mm,
  h: (b.maxY - b.minY) as Mm,
});
