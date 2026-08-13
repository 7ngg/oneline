import {
  bboxSpan,
  dedupeConsecutive,
  isSimpleRing,
  normalizeRing,
  ringBbox,
  selfIntersections,
} from '../geometry/polygon';
import { violation, type Violation } from '../violations';
import { PLOT_MAX_SPAN, PLOT_MIN_SPAN, type Plot } from './types';

/** Stage 1 (plot half): geometric legality of the boundary and setbacks. */
export function validatePlot(plot: Plot): Violation[] {
  const out: Violation[] = [];

  // Simplicity is checked BEFORE area-based normalization: a symmetric bowtie
  // has zero signed area and would otherwise masquerade as "too few corners".
  const deduped = dedupeConsecutive(plot.boundary);
  if (deduped.length < 3) {
    out.push(
      violation('PLOT_TOO_FEW_VERTICES', 'error', 'The plot needs at least 3 corners enclosing an area.', [
        'plot',
      ]),
    );
    return out;
  }
  if (!isSimpleRing(deduped)) {
    const pairs = selfIntersections(deduped)
      .slice(0, 4)
      .map(([i, j]) => `${i + 1}–${j + 1}`)
      .join(', ');
    out.push(
      violation(
        'PLOT_SELF_INTERSECT',
        'error',
        `The plot boundary crosses itself (edges ${pairs}). Redraw so edges do not intersect.`,
        ['plot'],
      ),
    );
    return out;
  }

  const normalized = normalizeRing(deduped);
  if (!normalized) {
    out.push(
      violation('PLOT_TOO_FEW_VERTICES', 'error', 'The plot needs at least 3 corners enclosing an area.', [
        'plot',
      ]),
    );
    return out;
  }

  const span = bboxSpan(ringBbox(normalized));
  const maxSpan = Math.max(span.w, span.h);
  const minSpan = Math.min(span.w, span.h);
  if (maxSpan > PLOT_MAX_SPAN) {
    out.push(
      violation(
        'PLOT_ABSURD_SIZE',
        'error',
        `The plot spans ${(maxSpan / 1_000_000).toFixed(1)} km — did you enter metres as millimetres?`,
        ['plot'],
      ),
    );
  } else if (minSpan < PLOT_MIN_SPAN) {
    out.push(
      violation(
        'PLOT_ABSURD_SIZE',
        'error',
        `The plot is only ${(minSpan / 1000).toFixed(2)} m across — did you enter millimetres as metres?`,
        ['plot'],
      ),
    );
  }

  if ('perEdge' in plot.setback && plot.setback.perEdge.length !== plot.boundary.length) {
    out.push(
      violation(
        'PLOT_ABSURD_SIZE',
        'error',
        `Per-edge setbacks list ${plot.setback.perEdge.length} values but the boundary has ${plot.boundary.length} edges.`,
        ['plot'],
      ),
    );
  }

  return out;
}
