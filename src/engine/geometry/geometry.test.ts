import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rectilinearPolyArb, simpleRingArb } from '../../test/arbitraries';
import { mm } from '../units';
import {
  area2OfPoly,
  cellsForRects,
  erosionSurvives,
  intersectionArea2,
  isRectilinear,
  offsetPoly,
  tessellationToleranceArea2,
  unionPolys,
} from './clip';
import { collinearOverlap, sharedBoundaryLength, sharedSegments } from './measure';
import {
  area2,
  isCCW,
  isSimpleRing,
  normalizeRing,
  pointInRing,
  poly,
  ringBbox,
  ringPerimeter,
  signedArea2,
  type Poly,
} from './polygon';
import { rect, rectRing } from './rect';
import { v } from './vec';

describe('normalizeRing', () => {
  it('is idempotent and yields CCW, duplicate-free, collinear-free rings', () => {
    fc.assert(
      fc.property(simpleRingArb, (ring) => {
        const once = normalizeRing(ring);
        fc.pre(once !== null);
        const twice = normalizeRing(once as NonNullable<typeof once>);
        expect(twice).toEqual(once);
        expect(isCCW(once as NonNullable<typeof once>)).toBe(true);
        expect(area2(once as NonNullable<typeof once>)).toBeGreaterThan(0);
      }),
    );
  });

  it('drops duplicate and collinear vertices', () => {
    const ring = [v(0, 0), v(5000, 0), v(5000, 0), v(10000, 0), v(10000, 10000), v(0, 10000)];
    const n = normalizeRing(ring);
    expect(n).not.toBeNull();
    expect(n).toHaveLength(4);
    expect(area2(n as NonNullable<typeof n>)).toBe(2 * 10000 * 10000);
  });

  it('rejects degenerate rings', () => {
    expect(normalizeRing([v(0, 0), v(1000, 0)])).toBeNull();
    expect(normalizeRing([v(0, 0), v(1000, 0), v(2000, 0)])).toBeNull(); // zero area
  });

  it('reverses CW input to CCW', () => {
    const cw = [v(0, 0), v(0, 5000), v(5000, 5000), v(5000, 0)];
    const n = normalizeRing(cw);
    expect(n && signedArea2(n) > 0).toBe(true);
  });
});

describe('isSimpleRing / pointInRing', () => {
  it('star-shaped generated rings are simple', () => {
    fc.assert(
      fc.property(simpleRingArb, (ring) => {
        const n = normalizeRing(ring);
        fc.pre(n !== null);
        expect(isSimpleRing(n as NonNullable<typeof n>)).toBe(true);
      }),
    );
  });

  it('detects a bowtie', () => {
    const bowtie = [v(0, 0), v(10000, 10000), v(10000, 0), v(0, 10000)];
    expect(isSimpleRing(bowtie)).toBe(false);
  });

  it('classifies points against a square', () => {
    const square = rectRing(rect(0, 0, 10000, 10000));
    expect(pointInRing(v(5000, 5000), square)).toBe('inside');
    expect(pointInRing(v(15000, 5000), square)).toBe('outside');
    expect(pointInRing(v(0, 5000), square)).toBe('boundary');
    expect(pointInRing(v(0, 0), square)).toBe('boundary');
  });
});

describe('clip wrapper exactness', () => {
  const stripsOver = (shape: Poly, fractions: number[]) => {
    const bb = ringBbox(shape.outer);
    const cuts = [...new Set(fractions.map((f) => mm(bb.minX + (bb.maxX - bb.minX) * f)))]
      .filter((x) => x > bb.minX && x < bb.maxX)
      .sort((a, b) => a - b);
    const xs = [bb.minX, ...cuts, bb.maxX];
    const strips = xs
      .slice(0, -1)
      .map((x, i) => rectRing(rect(x, bb.minY, (xs[i + 1] as number) - x, bb.maxY - bb.minY)));
    const cutLength = cuts.length * (bb.maxY - bb.minY);
    return { strips, cutLength };
  };

  const fractionsArb = fc.array(fc.double({ min: 0.15, max: 0.85, noNaN: true }), {
    minLength: 1,
    maxLength: 5,
  });

  it('rectilinear footprints tessellate EXACTLY: areas sum to the whole, overlaps zero', () => {
    fc.assert(
      fc.property(rectilinearPolyArb, fractionsArb, (shape, fractions) => {
        expect(isRectilinear(shape.outer)).toBe(true);
        const { strips } = stripsOver(shape, fractions);
        fc.pre(strips.length > 1);
        const cells = cellsForRects(shape, strips);
        const total = cells.flat().reduce((s, p) => s + area2OfPoly(p), 0);
        expect(total).toBe(area2OfPoly(shape));
        for (let i = 0; i < cells.length; i++) {
          for (let j = i + 1; j < cells.length; j++) {
            for (const a of cells[i] as Poly[]) {
              for (const b of cells[j] as Poly[]) {
                expect(intersectionArea2(a, b)).toBe(0);
              }
            }
          }
        }
      }),
      { numRuns: 50 },
    );
  });

  it('diagonal footprints tessellate within the documented sub-mm skin tolerance', () => {
    fc.assert(
      fc.property(simpleRingArb, fractionsArb, (ring, fractions) => {
        const n = normalizeRing(ring);
        fc.pre(n !== null);
        const shape = poly(n as NonNullable<typeof n>);
        const { strips, cutLength } = stripsOver(shape, fractions);
        fc.pre(strips.length > 1);
        const cells = cellsForRects(shape, strips);
        const total = cells.flat().reduce((s, p) => s + area2OfPoly(p), 0);
        const tol = tessellationToleranceArea2(ringPerimeter(shape.outer) + cutLength);
        expect(Math.abs(total - area2OfPoly(shape))).toBeLessThanOrEqual(tol);
      }),
      { numRuns: 40 },
    );
  });

  it('erosion of a rect survives iff both sides exceed 2r', () => {
    const r = rect(0, 0, 10000, 4000);
    const p = poly(rectRing(r));
    expect(erosionSurvives(p, mm(1900))).toBe(true);
    expect(erosionSurvives(p, mm(2100))).toBe(false);
  });

  it('offset inward of a square gives the shrunken square', () => {
    const p = poly(rectRing(rect(0, 0, 10000, 10000)));
    const shrunk = offsetPoly(p, mm(-1000));
    expect(shrunk).toHaveLength(1);
    expect(area2OfPoly(shrunk[0] as NonNullable<(typeof shrunk)[0]>)).toBe(2 * 8000 * 8000);
  });

  it('union of two touching rects merges them', () => {
    const a = poly(rectRing(rect(0, 0, 5000, 5000)));
    const b = poly(rectRing(rect(5000, 0, 5000, 5000)));
    const u = unionPolys([a, b]);
    expect(u).toHaveLength(1);
    expect(area2OfPoly(u[0] as NonNullable<(typeof u)[0]>)).toBe(2 * 10000 * 5000);
  });
});

describe('measure', () => {
  it('collinearOverlap finds exact overlap of collinear segments', () => {
    const ov = collinearOverlap(v(0, 0), v(10000, 0), v(4000, 0), v(15000, 0));
    expect(ov).not.toBeNull();
    const xs = [ov?.a.x, ov?.b.x].sort((x, y) => (x as number) - (y as number));
    expect(xs).toEqual([4000, 10000]);
  });

  it('returns null for parallel non-collinear or point-touching segments', () => {
    expect(collinearOverlap(v(0, 0), v(10000, 0), v(0, 100), v(10000, 100))).toBeNull();
    expect(collinearOverlap(v(0, 0), v(10000, 0), v(10000, 0), v(20000, 0))).toBeNull();
  });

  it('adjacent rects share their full common edge', () => {
    const a = poly(rectRing(rect(0, 0, 5000, 5000)));
    const b = poly(rectRing(rect(5000, 0, 5000, 5000)));
    const segs = sharedSegments(a, b);
    expect(segs).toHaveLength(1);
    expect(sharedBoundaryLength(a, b)).toBe(5000);
  });

  it('partially offset rects share the overlapping run', () => {
    const a = poly(rectRing(rect(0, 0, 5000, 5000)));
    const b = poly(rectRing(rect(5000, 2000, 5000, 5000)));
    expect(sharedBoundaryLength(a, b)).toBe(3000);
  });
});
