// Shared-boundary measurement between polygons: the basis for adjacency
// scoring and door placement. All collinearity tests are exact.

import type { Mm } from '../units';
import type { Poly, Ring } from './polygon';
import { dist, orient, type Vec } from './vec';

export interface Seg {
  a: Vec;
  b: Vec;
}

export const segLength = (s: Seg): number => dist(s.a, s.b);

export function ringEdges(ring: Ring): Seg[] {
  return ring.map((p, i) => ({ a: p, b: ring[(i + 1) % ring.length] as Vec }));
}

export function polyEdges(p: Poly): Seg[] {
  return [...ringEdges(p.outer), ...p.holes.flatMap((h) => ringEdges(h))];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Canonical signature of the infinite line through a segment, so collinear
 * segments can be grouped exactly: reduced direction (dx, dy) with canonical
 * sign, plus the line offset c = dx·y0 − dy·x0.
 */
export function lineKey(a: Vec, b: Vec): string {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const g = gcd(Math.abs(dx), Math.abs(dy));
  if (g > 0) {
    dx /= g;
    dy /= g;
  }
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }
  const c = dx * a.y - dy * a.x;
  return `${dx},${dy},${c}`;
}

/** Scalar parameter of p along the canonical direction of its line. */
function lineParam(a: Vec, b: Vec, p: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // project on dominant axis — exact for lattice points on the line
  return Math.abs(dx) >= Math.abs(dy)
    ? dx >= 0
      ? p.x
      : -p.x
    : dy >= 0
      ? p.y
      : -p.y;
}

/**
 * Overlap of two collinear segments; null when not collinear or the overlap
 * is a point. Overlap endpoints are always original vertices, hence exact.
 */
export function collinearOverlap(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Seg | null {
  if (orient(a1, a2, b1) !== 0 || orient(a1, a2, b2) !== 0) return null;
  const pts: Vec[] = [a1, a2, b1, b2];
  const t = pts.map((p) => lineParam(a1, a2, p));
  const [ta1, ta2, tb1, tb2] = t as [number, number, number, number];
  const aLo = Math.min(ta1, ta2);
  const aHi = Math.max(ta1, ta2);
  const bLo = Math.min(tb1, tb2);
  const bHi = Math.max(tb1, tb2);
  const lo = Math.max(aLo, bLo);
  const hi = Math.min(aHi, bHi);
  if (lo >= hi) return null;
  const at = (want: number): Vec => {
    const i = t.findIndex((v) => v === want);
    return pts[i] as Vec;
  };
  return { a: at(lo), b: at(hi) };
}

/**
 * All shared boundary runs between two polys, merged into maximal segments
 * per line. Total length feeds adjacency scoring; the longest run hosts doors.
 */
export function sharedSegments(a: Poly, b: Poly): Seg[] {
  const overlaps: Array<{ key: string; seg: Seg }> = [];
  const edgesA = polyEdges(a);
  const edgesB = polyEdges(b);
  for (const ea of edgesA) {
    for (const eb of edgesB) {
      const ov = collinearOverlap(ea.a, ea.b, eb.a, eb.b);
      if (ov) overlaps.push({ key: lineKey(ov.a, ov.b), seg: ov });
    }
  }
  // merge touching/overlapping intervals on the same line
  const byLine = new Map<string, Seg[]>();
  for (const { key, seg } of overlaps) {
    const list = byLine.get(key) ?? [];
    list.push(seg);
    byLine.set(key, list);
  }
  interface Interval {
    lo: number;
    hi: number;
    pLo: Vec;
    pHi: Vec;
  }
  const merged: Seg[] = [];
  for (const segs of byLine.values()) {
    const withParams: Interval[] = segs
      .map((s) => {
        const lo = lineParam(s.a, s.b, s.a);
        const hi = lineParam(s.a, s.b, s.b);
        return lo <= hi ? { lo, hi, pLo: s.a, pHi: s.b } : { lo: hi, hi: lo, pLo: s.b, pHi: s.a };
      })
      .sort((x, y) => x.lo - y.lo);
    const first = withParams[0];
    if (!first) continue;
    let cur: Interval = first;
    for (let i = 1; i < withParams.length; i++) {
      const nxt = withParams[i] as Interval;
      if (nxt.lo <= cur.hi) {
        if (nxt.hi > cur.hi) {
          cur = { lo: cur.lo, hi: nxt.hi, pLo: cur.pLo, pHi: nxt.pHi };
        }
      } else {
        merged.push({ a: cur.pLo, b: cur.pHi });
        cur = nxt;
      }
    }
    merged.push({ a: cur.pLo, b: cur.pHi });
  }
  return merged;
}

export function sharedBoundaryLength(a: Poly, b: Poly): number {
  return sharedSegments(a, b).reduce((s, seg) => s + segLength(seg), 0);
}

export function longestSharedSegment(a: Poly, b: Poly): Seg | null {
  let best: Seg | null = null;
  let bestLen = 0;
  for (const seg of sharedSegments(a, b)) {
    const len = segLength(seg);
    if (len > bestLen) {
      bestLen = len;
      best = seg;
    }
  }
  return best;
}

/** Sum of exterior boundary length a poly shares with a boundary poly's outline. */
export function totalSharedLength(segs: Seg[]): Mm {
  return Math.round(segs.reduce((s, seg) => s + segLength(seg), 0)) as Mm;
}
