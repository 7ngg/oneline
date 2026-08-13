// Quick arithmetic + erosion prechecks before any layout search, with RANKED
// one-click relaxations when the program cannot fit. Ranking = smallest
// relative change first.

import { area2OfPoly, erosionSurvives } from '../geometry/clip';
import type { Poly } from '../geometry/polygon';
import { m2FromMm2, mm, mm2, type Mm2 } from '../units';
import { violation, type Violation, type ViolationFix } from '../violations';
import type { Plot } from '../plot/types';
import type { Program, RoomSpec } from '../program/types';

export type FeasibilityVerdict = 'ok' | 'tight' | 'infeasible';

export interface FeasibilityReport {
  verdict: FeasibilityVerdict;
  violations: Violation[];
}

export function checkFeasibility(program: Program, plot: Plot, footprint: Poly): FeasibilityReport {
  const out: Violation[] = [];
  const rooms = program.rooms;
  const factor = program.circulation.factor;
  const footprintArea = area2OfPoly(footprint) / 2;

  const sumMin = rooms.reduce((s, r) => s + r.area.min, 0);
  const sumIdeal = rooms.reduce((s, r) => s + r.area.ideal, 0);
  const neededMin = sumMin * (1 + factor);
  const neededIdeal = sumIdeal * (1 + factor);

  let verdict: FeasibilityVerdict = 'ok';

  if (neededMin > footprintArea * 0.98) {
    verdict = 'infeasible';
    const deficit = mm2(neededMin - footprintArea * 0.98);
    out.push(
      violation(
        'AREA_INFEASIBLE',
        'error',
        `Rooms need at least ${fmt(mm2(neededMin))} m² (incl. ${Math.round(factor * 100)}% circulation) but the footprint offers ${fmt(mm2(footprintArea))} m².`,
        ['program'],
        rankedAreaFixes(program, plot, deficit)[0],
      ),
    );
    for (const fix of rankedAreaFixes(program, plot, deficit).slice(1, 4)) {
      out.push(violation('AREA_INFEASIBLE', 'info', `Alternative: ${fix.label}`, ['program'], fix));
    }
  } else if (neededIdeal > footprintArea) {
    verdict = 'tight';
    out.push(
      violation(
        'AREA_TIGHT',
        'warning',
        `Target areas total ${fmt(mm2(neededIdeal))} m² against ${fmt(mm2(footprintArea))} m² available — rooms will be squeezed proportionally.`,
        ['program'],
      ),
    );
  }

  // erosion test: can the narrowest requirement fit anywhere at all?
  const narrowest = rooms.reduce(
    (min, r) => (r.minDim < min.minDim ? r : min),
    rooms[0] as RoomSpec,
  );
  if (rooms.length > 0 && !erosionSurvives(footprint, mm(narrowest.minDim / 2))) {
    verdict = 'infeasible';
    out.push(
      violation(
        'MIN_DIM_UNSATISFIABLE',
        'error',
        `The footprint is nowhere wide enough for even the narrowest room ("${narrowest.name}" needs ${narrowest.minDim / 1000} m clear).`,
        [narrowest.id],
        {
          label: `Reduce "${narrowest.name}" min width to ${Math.max(0.6, narrowest.minDim / 2000)} m`,
          relaxation: { kind: 'roomMinDim', roomId: narrowest.id, value: mm(Math.max(600, narrowest.minDim / 2)) },
        },
      ),
    );
  }

  return { verdict, violations: out };
}

/** Fixes for an area deficit, smallest relative change first. */
function rankedAreaFixes(program: Program, plot: Plot, deficit: Mm2): ViolationFix[] {
  const fixes: ViolationFix[] = [];
  const factor = program.circulation.factor;

  // 1. reduce circulation factor
  if (factor > 0.06) {
    const target = Math.max(0.05, Math.round((factor - 0.05) * 100) / 100);
    fixes.push({
      label: `Reduce circulation allowance to ${Math.round(target * 100)}%`,
      relaxation: { kind: 'circulationFactor', value: target },
    });
  }

  // 2. shrink the largest room's minimum
  const largest = [...program.rooms].sort((a, b) => b.area.min - a.area.min)[0];
  if (largest) {
    const cut = Math.min(largest.area.min * 0.3, deficit * 1.1);
    const target = mm2(Math.max(largest.area.min - cut, largest.area.min * 0.6));
    if (target < largest.area.min) {
      fixes.push({
        label: `Reduce "${largest.name}" minimum to ${fmt(target)} m²`,
        relaxation: { kind: 'roomAreaMin', roomId: largest.id, value: target },
      });
    }
  }

  // 3. reduce setback
  if ('uniform' in plot.setback && plot.setback.uniform >= 500) {
    const target = mm(Math.max(0, plot.setback.uniform - 1000));
    fixes.push({
      label: `Reduce setback to ${target / 1000} m`,
      relaxation: { kind: 'setbackUniform', value: target },
    });
  }

  return fixes;
}

const fmt = (a: Mm2): string => m2FromMm2(a).toFixed(1);
