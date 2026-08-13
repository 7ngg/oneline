// Axis-aligned integer rectangles — the currency of the slicing-tree solver.

import { mm, type Mm } from '../units';
import type { Bbox, Ring } from './polygon';

export interface Rect {
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({
  x: mm(x),
  y: mm(y),
  w: mm(w),
  h: mm(h),
});

export const rectFromBbox = (b: Bbox): Rect => rect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);

/** CCW ring (Y-up convention). */
export const rectRing = (r: Rect): Ring => [
  { x: r.x, y: r.y },
  { x: (r.x + r.w) as Mm, y: r.y },
  { x: (r.x + r.w) as Mm, y: (r.y + r.h) as Mm },
  { x: r.x, y: (r.y + r.h) as Mm },
];

export const rectArea2 = (r: Rect): number => 2 * r.w * r.h;
export const rectMinSide = (r: Rect): Mm => Math.min(r.w, r.h) as Mm;
export const rectAspect = (r: Rect): number =>
  r.w === 0 || r.h === 0 ? Infinity : Math.max(r.w, r.h) / Math.min(r.w, r.h);

/** Split at absolute coordinate `at`; dir 'v' = vertical cut (left|right). */
export function splitRect(r: Rect, dir: 'v' | 'h', at: Mm): [Rect, Rect] {
  if (dir === 'v') {
    return [rect(r.x, r.y, at - r.x, r.h), rect(at, r.y, r.x + r.w - at, r.h)];
  }
  return [rect(r.x, r.y, r.w, at - r.y), rect(r.x, at, r.w, r.y + r.h - at)];
}

export const rectCenter = (r: Rect): { x: Mm; y: Mm } => ({
  x: mm(r.x + r.w / 2),
  y: mm(r.y + r.h / 2),
});
