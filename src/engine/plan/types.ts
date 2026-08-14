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

/**
 * Connection taxonomy (design_rules_v4 §2): a plain hinged door, a doorless
 * open passage (a wall that simply stops — CT01's dashed line), or a sliding
 * glass partition (the standard kitchen↔living separation).
 */
export type DoorKind = 'door' | 'open' | 'sliding';

export interface Door extends Opening {
  /**
   * Side of the wall the leaf opens into, relative to the wall's a→b
   * direction (world coords): 'left' = wall.leftRoomId's side.
   */
  swing: 'left' | 'right';
  /** Hinge end along the wall axis: 'a' = at the t0 end (default). Do01. */
  hinge?: 'a' | 'b';
  /** Absent = 'door' (older saves predate the taxonomy). */
  kind?: DoorKind;
  connects: [string, string | 'outside'];
}

export type Window = Opening;

/** Placeable furniture/fixture kinds (design_rules_v4 §14, W04/W05/W07). */
export type FurnitureKind =
  | 'bed-double'
  | 'bed-single'
  | 'bedside'
  | 'wardrobe'
  | 'desk'
  | 'sofa'
  | 'coffee-table'
  | 'dining-table'
  | 'worktop'
  | 'appliance'
  | 'bath'
  | 'basin'
  | 'toilet'
  | 'washer'
  | 'shoe-cabinet'
  | 'shelf';

export interface FurnitureItem {
  /** Deterministic per-room id: `${roomId}-f0`, `-f1`, … */
  id: string;
  roomId: string;
  kind: FurnitureKind;
  /** Axis-aligned rect in world mm. */
  x: Mm;
  y: Mm;
  w: Mm;
  h: Mm;
  /** Direction from the host wall into the room — orients the glyph. */
  facing: 'N' | 'E' | 'S' | 'W';
}

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
  /** Auto-placed furniture (absent in saves that predate the feature). */
  furniture?: FurnitureItem[];
  violations: Violation[];
  metrics: Metrics;
}
