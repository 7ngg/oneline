import type { Mm, Mm2 } from '../units';

export type RoomType =
  | 'living'
  | 'bedroom'
  | 'kitchen'
  | 'bathroom'
  | 'wc'
  | 'hall'
  | 'storage'
  | 'balcony'
  | 'other';

export type Orientation = 'N' | 'E' | 'S' | 'W';

export interface RoomPrefs {
  exteriorWall?: boolean;
  orientation?: Orientation;
  nearEntrance?: boolean;
}

export interface RoomSpec {
  id: string;
  name: string;
  type: RoomType;
  area: { min: Mm2; ideal: Mm2; max: Mm2 };
  /** Narrowest acceptable clear dimension. */
  minDim: Mm;
  prefs: RoomPrefs;
}

export type AdjacencyKind = 'required' | 'preferred' | 'avoid';

export interface AdjacencyRule {
  a: string;
  b: string;
  kind: AdjacencyKind;
  weight: 1 | 2 | 3;
}

export interface ProgramDefaults {
  wallExt: Mm;
  wallInt: Mm;
  doorWidth: Mm;
  windowWidth: Mm;
}

export interface Program {
  rooms: RoomSpec[];
  /** Soft constraints — scored, never enforced. */
  adjacency: AdjacencyRule[];
  circulation: { mode: 'implicit'; factor: number };
  defaults: ProgramDefaults;
}

export const ROOM_COUNT_HARD_CAP = 30;
export const ROOM_COUNT_PERF_WARN = 15;
export const DOOR_MIN_WIDTH = 700 as Mm;
export const DOOR_JAMB = 100 as Mm;
