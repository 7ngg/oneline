// Corridor carving: the hall stops being a hopeful box in the slicing tree
// and becomes a FIXED strip running from the entrance edge into the plan.
// Every room that slices the leftover region can then border the corridor —
// circulation by construction instead of by luck.

import { intersectPolys, largestPoly, subtractPolys, area2OfPoly } from '../geometry/clip';
import { poly, ringBbox, type Poly } from '../geometry/polygon';
import { rectRing, rect } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import { mm } from '../units';
import type { Rng } from '../rng';
import type { RoomSpec } from '../program/types';

const CORRIDOR_WIDTH = 1_350; // mm — comfortable single-loaded corridor
const MIN_LENGTH = 2_200;

export interface CorridorFixture {
  hallCell: Poly;
  region: Poly;
}

/**
 * Carve a corridor strip perpendicular to the footprint edge nearest the
 * entrance, jittered slightly per candidate for diversity. Returns null when
 * the geometry refuses (strip would bisect the footprint, or the hall cell
 * comes out too small) — callers fall back to other candidate families.
 */
export function corridorFixture(
  footprint: Poly,
  hall: RoomSpec,
  entrance: Vec,
  rng: Rng,
): CorridorFixture | null {
  const bb = ringBbox(footprint.outer);
  const spanX = bb.maxX - bb.minX;
  const spanY = bb.maxY - bb.minY;

  // nearest side to the entrance point
  const dists: Array<['S' | 'N' | 'W' | 'E', number]> = [
    ['S', Math.abs(entrance.y - bb.minY)],
    ['N', Math.abs(entrance.y - bb.maxY)],
    ['W', Math.abs(entrance.x - bb.minX)],
    ['E', Math.abs(entrance.x - bb.maxX)],
  ];
  dists.sort((a, b) => a[1] - b[1]);
  const side = (dists[0] as ['S' | 'N' | 'W' | 'E', number])[0];

  const vertical = side === 'S' || side === 'N';
  const depthSpan = vertical ? spanY : spanX;
  // never bisect: leave at least a room's worth of region beyond the strip
  const maxLen = depthSpan - 2_600;
  if (maxLen < MIN_LENGTH) return null;
  const targetLen = Math.min(Math.max(hall.area.ideal / CORRIDOR_WIDTH, MIN_LENGTH), maxLen, depthSpan * 0.62);

  const jitter = (rng.next() - 0.5) * 2_000;
  const across = vertical
    ? Math.min(Math.max(entrance.x + jitter, bb.minX + 600), bb.maxX - 600 - CORRIDOR_WIDTH)
    : Math.min(Math.max(entrance.y + jitter, bb.minY + 600), bb.maxY - 600 - CORRIDOR_WIDTH);

  const strip =
    side === 'S'
      ? rect(across, bb.minY, CORRIDOR_WIDTH, targetLen)
      : side === 'N'
        ? rect(across, bb.maxY - targetLen, CORRIDOR_WIDTH, targetLen)
        : side === 'W'
          ? rect(bb.minX, across, targetLen, CORRIDOR_WIDTH)
          : rect(bb.maxX - targetLen, across, targetLen, CORRIDOR_WIDTH);
  const stripPoly = poly(rectRing(strip));

  const hallCell = largestPoly(intersectPolys(footprint, stripPoly));
  if (!hallCell) return null;
  // the corridor must be worth having: at least 70% of the hall's minimum
  if (area2OfPoly(hallCell) < 2 * hall.area.min * 0.7) return null;

  const regionParts = subtractPolys(footprint, stripPoly);
  if (regionParts.length !== 1) return null; // bisected the plan — refuse
  const region = regionParts[0] as Poly;
  // sanity: region must still hold the remaining program
  if (area2OfPoly(region) < area2OfPoly(footprint) * 0.5) return null;

  return { hallCell, region };
}

export const CORRIDOR_WIDTH_MM = mm(CORRIDOR_WIDTH);
