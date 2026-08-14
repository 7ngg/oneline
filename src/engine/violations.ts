// Single source of truth for every violation the engine can raise.
// Messages are pre-formatted here so UI layers never re-template them.

import type { Mm, Mm2 } from './units';

export type Severity = 'error' | 'warning' | 'info';

export type ViolationCode =
  // plot
  | 'PLOT_SELF_INTERSECT'
  | 'PLOT_TOO_FEW_VERTICES'
  | 'PLOT_ABSURD_SIZE'
  | 'PLOT_HOLES_UNSUPPORTED'
  | 'SETBACK_EMPTY_FOOTPRINT'
  | 'FOOTPRINT_SPLIT_PARTS'
  // program
  | 'PROGRAM_EMPTY'
  | 'ROOM_AREA_RANGE_INVALID'
  | 'ROOM_MINDIM_INCONSISTENT'
  | 'ROOM_COUNT_EXCEEDED'
  | 'ROOM_COUNT_PERF_WARNING'
  | 'ADJACENCY_CONFLICT'
  | 'ADJACENCY_NONPLANAR_HINT'
  // feasibility
  | 'AREA_INFEASIBLE'
  | 'AREA_TIGHT'
  | 'MIN_DIM_UNSATISFIABLE'
  // solver runtime
  | 'SOLVER_TIMEOUT_PARTIAL'
  | 'SOLVER_NO_CANDIDATES'
  | 'SOLVER_NONFINITE_SCORES'
  | 'SOLVER_FEW_VARIANTS'
  | 'TOPOLOGY_CEILING'
  // plan output
  | 'DOOR_TOO_WIDE_FOR_WALL'
  | 'ROOM_UNREACHABLE'
  | 'PRIVATE_TRANSIT'
  | 'BEDROOM_THROUGH_HABITABLE'
  | 'FURNITURE_UNFIT'
  | 'DOOR_SWING_OBSTRUCTED'
  | 'ROOM_BELOW_MIN_AREA'
  | 'ROOM_MIN_DIM_VIOLATED'
  | 'ROOM_NO_EXTERIOR_WALL'
  | 'SLIVER_ROOM'
  | 'ENTRANCE_MOVED'
  | 'TESSELLATION_DRIFT';

/** Machine-applicable one-click fixes offered next to violations. */
export type Relaxation =
  | { kind: 'setbackUniform'; value: Mm }
  | { kind: 'roomAreaMin'; roomId: string; value: Mm2 }
  | { kind: 'roomMinDim'; roomId: string; value: Mm }
  | { kind: 'circulationFactor'; value: number }
  | { kind: 'dropAdjacency'; a: string; b: string };

export interface ViolationFix {
  label: string;
  relaxation: Relaxation;
}

export interface Violation {
  code: ViolationCode;
  severity: Severity;
  message: string;
  /** Room/wall/door ids, or 'plot' / 'program'. */
  subjects: string[];
  fix?: ViolationFix;
}

export const violation = (
  code: ViolationCode,
  severity: Severity,
  message: string,
  subjects: string[],
  fix?: ViolationFix,
): Violation => (fix ? { code, severity, message, subjects, fix } : { code, severity, message, subjects });

export const hasErrors = (vs: Violation[]): boolean => vs.some((v) => v.severity === 'error');

export const worstSeverity = (vs: Violation[]): Severity | null => {
  if (vs.some((v) => v.severity === 'error')) return 'error';
  if (vs.some((v) => v.severity === 'warning')) return 'warning';
  if (vs.length > 0) return 'info';
  return null;
};
