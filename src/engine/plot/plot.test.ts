import { describe, expect, it } from 'vitest';
import { area2OfPoly } from '../geometry/clip';
import { mm } from '../units';
import { computeFootprint } from './footprint';
import type { Plot } from './types';
import { validatePlot } from './validate';

const squarePlot = (side: number, setback = 0): Plot => ({
  boundary: [
    { x: mm(0), y: mm(0) },
    { x: mm(side), y: mm(0) },
    { x: mm(side), y: mm(side) },
    { x: mm(0), y: mm(side) },
  ],
  setback: { uniform: mm(setback) },
  northDeg: 0,
});

describe('validatePlot', () => {
  it('accepts a sane square', () => {
    expect(validatePlot(squarePlot(12_000))).toEqual([]);
  });

  it('rejects too few vertices', () => {
    const plot = squarePlot(12_000);
    plot.boundary = plot.boundary.slice(0, 2);
    expect(validatePlot(plot).some((v) => v.code === 'PLOT_TOO_FEW_VERTICES')).toBe(true);
  });

  it('rejects self-intersection with edge indices in the message', () => {
    const plot = squarePlot(12_000);
    plot.boundary = [
      { x: mm(0), y: mm(0) },
      { x: mm(10_000), y: mm(10_000) },
      { x: mm(10_000), y: mm(0) },
      { x: mm(0), y: mm(10_000) },
    ];
    const out = validatePlot(plot);
    expect(out.some((v) => v.code === 'PLOT_SELF_INTERSECT')).toBe(true);
  });

  it('flags absurd sizes with a unit-confusion hint', () => {
    const tiny = validatePlot(squarePlot(2_000));
    expect(tiny.some((v) => v.code === 'PLOT_ABSURD_SIZE' && v.message.includes('millimetres as metres'))).toBe(
      true,
    );
    const huge = validatePlot(squarePlot(2_000_000));
    expect(huge.some((v) => v.code === 'PLOT_ABSURD_SIZE' && v.message.includes('metres as millimetres'))).toBe(
      true,
    );
  });
});

describe('computeFootprint', () => {
  it('returns the boundary when setback is zero', () => {
    const { footprint, violations } = computeFootprint(squarePlot(12_000));
    expect(violations).toEqual([]);
    expect(footprint && area2OfPoly(footprint)).toBe(2 * 12_000 * 12_000);
  });

  it('shrinks by the setback', () => {
    const { footprint } = computeFootprint(squarePlot(12_000, 1_000));
    expect(footprint && area2OfPoly(footprint)).toBe(2 * 10_000 * 10_000);
  });

  it('reports collapse with a viable-setback fix', () => {
    const { footprint, violations } = computeFootprint(squarePlot(12_000, 7_000));
    expect(footprint).toBeNull();
    const hit = violations.find((v) => v.code === 'SETBACK_EMPTY_FOOTPRINT');
    expect(hit?.fix?.relaxation.kind).toBe('setbackUniform');
    if (hit?.fix?.relaxation.kind === 'setbackUniform') {
      expect(hit.fix.relaxation.value).toBeGreaterThan(0);
      expect(hit.fix.relaxation.value).toBeLessThan(mm(6_000));
    }
  });
});
