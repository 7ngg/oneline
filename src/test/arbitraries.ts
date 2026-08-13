// fast-check generators shared by engine test suites.

import fc from 'fast-check';
import { unionPolys } from '../engine/geometry/clip';
import { poly, type Poly, type Ring } from '../engine/geometry/polygon';
import { rect, rectRing, type Rect } from '../engine/geometry/rect';
import { mm } from '../engine/units';

/**
 * Random simple polygon by star-shaped construction: distinct sorted angles
 * around a center with generous radii, so integer rounding cannot create
 * self-intersections.
 */
export const simpleRingArb: fc.Arbitrary<Ring> = fc
  .record({
    cx: fc.integer({ min: -50_000, max: 50_000 }),
    cy: fc.integer({ min: -50_000, max: 50_000 }),
    // radii within a bounded ratio and generous angular gaps: after integer
    // rounding no chord can graze another vertex, so simplicity is preserved
    steps: fc.array(
      fc.record({
        gap: fc.double({ min: 0.25, max: 1.2, noNaN: true }),
        radius: fc.integer({ min: 8_000, max: 30_000 }),
      }),
      { minLength: 3, maxLength: 12 },
    ),
  })
  .map(({ cx, cy, steps }) => {
    const totalGap = steps.reduce((s, x) => s + x.gap, 0);
    const scale = (Math.PI * 2) / totalGap;
    let angle = 0;
    const ring: Ring = [];
    for (const s of steps) {
      angle += s.gap * scale;
      ring.push({
        x: mm(cx + Math.cos(angle) * s.radius),
        y: mm(cy + Math.sin(angle) * s.radius),
      });
    }
    return ring;
  });

/**
 * Rectilinear (axis-aligned) footprint: union of 1–3 rects, each chained to
 * overlap the previous one so the union is a single polygon (L/T/Z shapes).
 */
export const rectilinearPolyArb: fc.Arbitrary<Poly> = fc
  .array(
    fc.record({
      dx: fc.integer({ min: -4_000, max: 4_000 }),
      dy: fc.integer({ min: -4_000, max: 4_000 }),
      w: fc.integer({ min: 6_000, max: 25_000 }),
      h: fc.integer({ min: 6_000, max: 25_000 }),
    }),
    { minLength: 1, maxLength: 3 },
  )
  .map((specs) => {
    let x = 0;
    let y = 0;
    const polys: Poly[] = [];
    for (const s of specs) {
      x += s.dx;
      y += s.dy;
      polys.push(poly(rectRing(rect(x, y, s.w, s.h))));
    }
    const u = unionPolys(polys);
    // chained offsets (|d| < min size) guarantee overlap → single poly
    return u[0] as Poly;
  });

export const rectArb: fc.Arbitrary<Rect> = fc
  .record({
    x: fc.integer({ min: -100_000, max: 100_000 }),
    y: fc.integer({ min: -100_000, max: 100_000 }),
    w: fc.integer({ min: 1_000, max: 60_000 }),
    h: fc.integer({ min: 1_000, max: 60_000 }),
  })
  .map(({ x, y, w, h }) => rect(x, y, w, h));
