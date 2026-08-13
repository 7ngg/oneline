// Furnishability v1 (design_rules_v4 §14): a room is only real if its
// standard furniture stands in it with NORM clearances — the architect's own
// bar ("the plan cannot be finally judged without furniture", Do07). This
// pass places nothing permanently; it proves a placement EXISTS and raises a
// warning when none does.
//
// Templates (F01 clearances, W04/W05 fixture runs, F06 observed layouts):
//   bedroom ≥ 12 m² : double bed 1600×2000 + 500 passages both sides + 600 approach
//   bedroom < 12 m² : single bed 900×2000 + 500 passage + 600 approach
//   living          : seating group (sofa + table + circulation)
//   kitchen         : 2400 worktop run 600 deep + 1200 clear in front
//   bathroom        : W05 fixture run ≈ 1.7 × 2.4 (bbox test)
//   wc              : W04 toilet 670×400 + 600 front clearance (bbox test)

import { area2OfPoly } from '../geometry/clip';
import { ringBbox } from '../geometry/polygon';
// (templates below cite design_rules_v4 rule IDs; keep them in sync)
import { lerp } from '../geometry/vec';
import { violation, type Violation } from '../violations';
import type { RoomSpec } from '../program/types';
import type { Door, PlanRoom, Wall } from './types';

interface Template {
  label: string;
  /** Extent along the wall the piece stands against. */
  w: number;
  /** Extent into the room, clearance included. */
  d: number;
  /** true = bbox-only test (wall-hugging fixtures, door opens outward). */
  bboxOnly?: boolean;
}

const templateFor = (spec: RoomSpec, grossArea: number): Template | null => {
  switch (spec.type) {
    case 'bedroom':
      return grossArea >= 12_000_000
        ? { label: 'a double bed with side passages', w: 2_600, d: 2_600 }
        : { label: 'a bed with its passage', w: 1_400, d: 2_600 };
    case 'living':
      return { label: 'a seating group', w: 2_500, d: 2_000 };
    case 'kitchen':
      return { label: 'a worktop run with clearance', w: 2_400, d: 1_800 };
    case 'bathroom':
      return { label: 'the bath + basin fixture run', w: 1_650, d: 2_300, bboxOnly: true };
    case 'wc':
      return { label: 'a toilet with clearance', w: 900, d: 1_400, bboxOnly: true };
    default:
      return null;
  }
};

const SLIDE_STEP = 200;

export function checkFurnishability(
  rooms: PlanRoom[],
  walls: Wall[],
  doors: Door[],
  specOf: Map<string, RoomSpec>,
): Violation[] {
  const violations: Violation[] = [];
  const wallById = new Map(walls.map((w) => [w.id, w]));

  for (const room of rooms) {
    const spec = specOf.get(room.specId);
    if (!spec) continue;
    const template = templateFor(spec, room.grossArea);
    if (!template) continue;

    const bb = ringBbox(room.poly.outer);
    const rw = bb.maxX - bb.minX;
    const rh = bb.maxY - bb.minY;
    // non-rectangular rooms (bbox visibly larger than the polygon): v1 skips
    // rather than guessing — L-shapes are rare outside halls
    if (area2OfPoly(room.poly) / 2 < rw * rh * 0.95) continue;

    const fitsEither = (w: number, d: number): boolean => (rw >= w && rh >= d) || (rw >= d && rh >= w);
    if (template.bboxOnly) {
      if (!fitsEither(template.w, template.d)) {
        violations.push(unfit(room.id, spec.name, template));
      }
      continue;
    }

    // door exclusion rects: the opening span extended door-width into the room
    interface Box {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
    const doorBoxes: Box[] = [];
    for (const door of doors) {
      const wall = wallById.get(door.wallId);
      if (!wall || (wall.leftRoomId !== room.id && wall.rightRoomId !== room.id)) continue;
      const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
      if (len === 0) continue;
      const p0 = lerp(wall.a, wall.b, door.t0);
      const p1 = lerp(wall.a, wall.b, Math.min(1, door.t0 + door.width / len));
      const horizontal = Math.abs(wall.b.y - wall.a.y) < Math.abs(wall.b.x - wall.a.x);
      if (horizontal) {
        const into = wall.a.y <= bb.minY + 1 ? 1 : -1; // extend toward interior
        const y0 = wall.a.y + (into > 0 ? 0 : -door.width);
        doorBoxes.push({ x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x), y0, y1: y0 + door.width });
      } else {
        const into = wall.a.x <= bb.minX + 1 ? 1 : -1;
        const x0 = wall.a.x + (into > 0 ? 0 : -door.width);
        doorBoxes.push({ y0: Math.min(p0.y, p1.y), y1: Math.max(p0.y, p1.y), x0, x1: x0 + door.width });
      }
    }
    const overlaps = (b: Box): boolean =>
      doorBoxes.some((d) => b.x0 < d.x1 && d.x0 < b.x1 && b.y0 < d.y1 && d.y0 < b.y1);

    // try the template against each wall, both orientations, sliding along it
    let placed = false;
    const tryWall = (w: number, d: number): boolean => {
      // south wall (y = minY) and north wall
      if (rw >= w && rh >= d) {
        for (const y0 of [bb.minY as number, bb.maxY - d]) {
          for (let x0 = bb.minX as number; x0 + w <= bb.maxX; x0 += SLIDE_STEP) {
            if (!overlaps({ x0, y0, x1: x0 + w, y1: y0 + d })) return true;
          }
        }
      }
      // west / east walls (piece rotated: w along Y)
      if (rh >= w && rw >= d) {
        for (const x0 of [bb.minX as number, bb.maxX - d]) {
          for (let y0 = bb.minY as number; y0 + w <= bb.maxY; y0 += SLIDE_STEP) {
            if (!overlaps({ x0, y0, x1: x0 + d, y1: y0 + w })) return true;
          }
        }
      }
      return false;
    };
    placed = tryWall(template.w, template.d);
    if (!placed) violations.push(unfit(room.id, spec.name, template));
  }
  return violations;
}

const unfit = (roomId: string, name: string, t: Template): Violation =>
  violation(
    'FURNITURE_UNFIT',
    'warning',
    `"${name}" cannot fit ${t.label} — needs ${(t.w / 1000).toFixed(1)} × ${(t.d / 1000).toFixed(1)} m clear of door swings.`,
    [roomId],
  );
