import type { Ring } from '../geometry/polygon';
import type { Mm } from '../units';

export type Setback = { uniform: Mm } | { perEdge: Mm[] };

export interface Plot {
  /** As drawn/entered; normalized on ingest (CCW, deduped). */
  boundary: Ring;
  setback: Setback;
  /** 0 = +Y is north, degrees clockwise. */
  northDeg: number;
  /** Preferred entry point: edge index + parameter t ∈ [0,1] along it. */
  entrance?: { edgeIndex: number; t: number };
}

export const PLOT_MIN_SPAN = 3_000 as Mm; // 3 m
export const PLOT_MAX_SPAN = 1_000_000 as Mm; // 1 km
