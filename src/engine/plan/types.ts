import type { Poly } from '../geometry/polygon';
import type { Vec } from '../geometry/vec';
import type { Mm, Mm2 } from '../units';
import type { Violation } from '../violations';

export interface PlanRoom {
  id: string;
  specId: string;
  poly: Poly;
  grossArea: Mm2;
  /** Gross minus wall-thickness/2 inset along every wall. */
  netArea: Mm2;
}

export interface Wall {
  id: string;
  a: Vec;
  b: Vec;
  thickness: Mm;
  kind: 'exterior' | 'interior';
  /** Room to the left/right of a→b; null = outside. */
  leftRoomId: string | null;
  rightRoomId: string | null;
}

export interface Opening {
  id: string;
  wallId: string;
  /** Parameter of the opening start along the wall's a→b axis, ∈ [0,1]. */
  t0: number;
  width: Mm;
}

export interface Door extends Opening {
  /**
   * Side of the wall the leaf opens into, relative to the wall's a→b
   * direction (world coords): 'left' = wall.leftRoomId's side.
   */
  swing: 'left' | 'right';
  connects: [string, string | 'outside'];
}

export type Window = Opening;

export interface Metrics {
  grossFloorArea: Mm2;
  netRoomArea: Mm2;
  circulationArea: Mm2;
  /** net / gross. */
  efficiency: number;
  adjacencyScore: number;
  areaFitScore: number;
  daylightScore: number;
  totalScore: number;
  /** Optional (added later; absent in older saves). */
  circulationScore?: number;
  wetClusterScore?: number;
  entranceScore?: number;
}

export interface PlanModel {
  id: string;
  /** Seed that reproduces this exact variant. */
  seed: number;
  footprint: Poly;
  /** Rooms tessellate the footprint (exact for rectilinear geometry). */
  rooms: PlanRoom[];
  walls: Wall[];
  doors: Door[];
  windows: Window[];
  violations: Violation[];
  metrics: Metrics;
}
