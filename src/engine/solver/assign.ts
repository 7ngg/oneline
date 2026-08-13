// Room → leaf assignment: greedy by area match plus preference bonuses, with
// seeded restarts. Works on leaf RECTS (pre-clip) for speed; the accurate
// exposure/orientation scoring happens later on clipped cells.

import { ringBbox, type Poly } from '../geometry/polygon';
import { rectCenter, rectMinSide, type Rect } from '../geometry/rect';
import type { Rng } from '../rng';
import type { RoomSpec } from '../program/types';

export type Assignment = number[]; // roomIndex → leafIndex

interface LeafInfo {
  rect: Rect;
  touchesBoundary: boolean;
  cx: number;
  cy: number;
}

export function assignRooms(
  rooms: RoomSpec[],
  leafRects: Rect[],
  footprint: Poly,
  rng: Rng,
  restarts = 4,
): Assignment {
  const bb = ringBbox(footprint.outer);
  const leaves: LeafInfo[] = leafRects.map((rect) => {
    const c = rectCenter(rect);
    return {
      rect,
      touchesBoundary:
        rect.x <= bb.minX + 50 ||
        rect.y <= bb.minY + 50 ||
        rect.x + rect.w >= bb.maxX - 50 ||
        rect.y + rect.h >= bb.maxY - 50,
      cx: c.x,
      cy: c.y,
    };
  });
  const midX = (bb.minX + bb.maxX) / 2;
  const midY = (bb.minY + bb.maxY) / 2;

  let best: Assignment | null = null;
  let bestCost = Infinity;

  for (let attempt = 0; attempt < restarts; attempt++) {
    const order = rng.shuffle(rooms.map((_, i) => i)).sort((a, b) => {
      const ra = rooms[a] as RoomSpec;
      const rb = rooms[b] as RoomSpec;
      return rb.area.ideal - ra.area.ideal;
    });
    const taken = new Set<number>();
    const assignment: Assignment = new Array<number>(rooms.length).fill(-1);
    let cost = 0;
    for (const roomIdx of order) {
      const room = rooms[roomIdx] as RoomSpec;
      let bestLeaf = -1;
      let bestLeafCost = Infinity;
      for (let leafIdx = 0; leafIdx < leaves.length; leafIdx++) {
        if (taken.has(leafIdx)) continue;
        const leaf = leaves[leafIdx] as LeafInfo;
        const leafArea = leaf.rect.w * leaf.rect.h * 2;
        const areaCost = Math.abs(leafArea - room.area.ideal * 2) / (room.area.ideal * 2);
        let prefCost = 0;
        if (room.prefs.exteriorWall && !leaf.touchesBoundary) prefCost += 0.6;
        if (room.prefs.orientation) {
          const match =
            (room.prefs.orientation === 'N' && leaf.cy > midY) ||
            (room.prefs.orientation === 'S' && leaf.cy < midY) ||
            (room.prefs.orientation === 'E' && leaf.cx > midX) ||
            (room.prefs.orientation === 'W' && leaf.cx < midX);
          if (!match) prefCost += 0.3;
        }
        if (rectMinSide(leaf.rect) < room.minDim) prefCost += 0.8;
        const jitter = rng.next() * 0.05;
        const total = areaCost + prefCost + jitter;
        if (total < bestLeafCost) {
          bestLeafCost = total;
          bestLeaf = leafIdx;
        }
      }
      if (bestLeaf === -1) break;
      taken.add(bestLeaf);
      assignment[roomIdx] = bestLeaf;
      cost += bestLeafCost;
    }
    if (assignment.every((x) => x >= 0) && cost < bestCost) {
      bestCost = cost;
      best = assignment;
    }
  }

  // fall back to identity if every restart failed (cannot happen when
  // leaf count === room count, but stay total)
  return best ?? rooms.map((_, i) => i);
}
