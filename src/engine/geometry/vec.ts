// Integer vector/segment primitives. All predicates are exact: coordinates are
// integer mm (|x| ≤ ~1e6), so cross products stay ≤ ~4e12, far below 2^53.

import { mm, type Mm } from '../units';

export interface Vec {
  x: Mm;
  y: Mm;
}

export const v = (x: number, y: number): Vec => ({ x: mm(x), y: mm(y) });
export const vEq = (a: Vec, b: Vec): boolean => a.x === b.x && a.y === b.y;
export const vSub = (a: Vec, b: Vec): Vec => ({ x: (a.x - b.x) as Mm, y: (a.y - b.y) as Mm });
export const vAdd = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) as Mm, y: (a.y + b.y) as Mm });

export const cross = (o: Vec, a: Vec, b: Vec): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Exact orientation sign: >0 counter-clockwise, <0 clockwise, 0 collinear. */
export const orient = (o: Vec, a: Vec, b: Vec): -1 | 0 | 1 => Math.sign(cross(o, a, b)) as -1 | 0 | 1;

export const dist2 = (a: Vec, b: Vec): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const dist = (a: Vec, b: Vec): number => Math.sqrt(dist2(a, b));

/** Exact test: p lies on the closed segment [a, b]. */
export const onSegment = (a: Vec, b: Vec, p: Vec): boolean =>
  orient(a, b, p) === 0 &&
  Math.min(a.x, b.x) <= p.x &&
  p.x <= Math.max(a.x, b.x) &&
  Math.min(a.y, b.y) <= p.y &&
  p.y <= Math.max(a.y, b.y);

/**
 * Exact closed-segment intersection test ([a,b] vs [c,d]), including endpoint
 * touches and collinear overlaps.
 */
export function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

/** Proper crossing only: interiors intersect in a single point. */
export function segmentsCrossProperly(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

/** Point at parameter t ∈ [0,1] along [a,b], rounded to integer mm. */
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({
  x: mm(a.x + (b.x - a.x) * t),
  y: mm(a.y + (b.y - a.y) * t),
});
