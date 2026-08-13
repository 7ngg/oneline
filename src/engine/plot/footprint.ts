import { area2OfPoly, largestPoly, offsetPoly } from '../geometry/clip';
import { normalizeRing, poly, type Poly } from '../geometry/polygon';
import { mm, type Mm } from '../units';
import { violation, type Violation } from '../violations';
import type { Plot } from './types';

export interface FootprintResult {
  footprint: Poly | null;
  violations: Violation[];
}

/**
 * Stage 2 (plot half): boundary → usable footprint via inward setback offset.
 * Per-edge setbacks are approximated by their maximum (uniform) in MVP —
 * noted as an info violation when they differ.
 */
export function computeFootprint(plot: Plot): FootprintResult {
  const violations: Violation[] = [];
  const boundary = normalizeRing(plot.boundary);
  if (!boundary) {
    return {
      footprint: null,
      violations: [violation('PLOT_TOO_FEW_VERTICES', 'error', 'The plot boundary is degenerate.', ['plot'])],
    };
  }
  const base = poly(boundary);

  let setback: Mm;
  if ('uniform' in plot.setback) {
    setback = plot.setback.uniform;
  } else {
    const values = plot.setback.perEdge;
    setback = mm(Math.max(0, ...values));
    if (new Set(values).size > 1) {
      violations.push(
        violation(
          'FOOTPRINT_SPLIT_PARTS',
          'info',
          `Per-edge setbacks are approximated by their maximum (${setback / 1000} m) in this version.`,
          ['plot'],
        ),
      );
    }
  }

  if (setback <= 0) {
    return { footprint: base, violations };
  }

  const parts = offsetPoly(base, mm(-setback));
  if (parts.length === 0) {
    const viable = maxViableSetback(base, setback);
    violations.push(
      violation(
        'SETBACK_EMPTY_FOOTPRINT',
        'error',
        `A ${setback / 1000} m setback leaves no buildable area. The largest workable setback is about ${viable / 1000} m.`,
        ['plot'],
        {
          label: `Reduce setback to ${viable / 1000} m`,
          relaxation: { kind: 'setbackUniform', value: viable },
        },
      ),
    );
    return { footprint: null, violations };
  }

  const footprint = largestPoly(parts) as Poly;
  if (parts.length > 1) {
    const wasted = parts
      .filter((p) => p !== footprint)
      .reduce((s, p) => s + area2OfPoly(p), 0);
    violations.push(
      violation(
        'FOOTPRINT_SPLIT_PARTS',
        'warning',
        `The setback splits the buildable area into ${parts.length} parts; the largest is used and ${(wasted / 2 / 1_000_000).toFixed(1)} m² is unused.`,
        ['plot'],
      ),
    );
  }

  return { footprint, violations };
}

/** Binary search the largest uniform setback that keeps some footprint. */
function maxViableSetback(base: Poly, upper: Mm): Mm {
  let lo = 0;
  let hi = upper;
  for (let i = 0; i < 12 && hi - lo > 10; i++) {
    const mid = mm((lo + hi) / 2);
    if (offsetPoly(base, mm(-mid)).length > 0) lo = mid;
    else hi = mid;
  }
  return mm(Math.floor(lo / 100) * 100);
}
