// Output invariants on a finished PlanModel. Never throws — violations only.

import { area2OfPoly, erosionSurvives, isRectilinear, tessellationToleranceArea2 } from '../geometry/clip';
import { polyBoundaryLength } from '../geometry/polygon';
import { mm } from '../units';
import { violation, type Violation } from '../violations';
import type { Program, RoomSpec } from '../program/types';
import type { Door, PlanModel, PlanRoom, Wall } from './types';
import { wallLength } from './walls';

export function validatePlan(plan: PlanModel, program: Program): Violation[] {
  const out: Violation[] = [];
  const specOf = new Map<string, RoomSpec>(program.rooms.map((r) => [r.id, r]));
  const nameOf = (room: PlanRoom): string => specOf.get(room.specId)?.name ?? room.specId;

  // coverage: Σ rooms vs footprint (exact for rectilinear, skin tolerance else)
  const total = plan.rooms.reduce((s, r) => s + area2OfPoly(r.poly), 0);
  const footprintArea = area2OfPoly(plan.footprint);
  const rectilinear = isRectilinear(plan.footprint.outer);
  const tolerance = rectilinear ? 0 : tessellationToleranceArea2(polyBoundaryLength(plan.footprint) * 2);
  if (Math.abs(total - footprintArea) > tolerance) {
    out.push(
      violation(
        'TESSELLATION_DRIFT',
        'warning',
        `Rooms cover ${(total / 2 / 1e6).toFixed(2)} m² of a ${(footprintArea / 2 / 1e6).toFixed(2)} m² footprint — geometry drifted beyond tolerance (please report this seed).`,
        [plan.id],
      ),
    );
  }

  // per-room checks
  for (const room of plan.rooms) {
    const spec = specOf.get(room.specId);
    if (!spec) continue;
    if (room.netArea < spec.area.min) {
      const shortfall = 1 - room.netArea / spec.area.min;
      out.push(
        violation(
          'ROOM_BELOW_MIN_AREA',
          shortfall > 0.03 ? 'error' : 'info',
          `"${nameOf(room)}" nets ${(room.netArea / 1e6).toFixed(1)} m², below its ${(spec.area.min / 1e6).toFixed(1)} m² minimum.`,
          [room.id],
        ),
      );
    }
    if (!erosionSurvives(room.poly, mm(spec.minDim / 2))) {
      out.push(
        violation(
          'ROOM_MIN_DIM_VIOLATED',
          'warning',
          `"${nameOf(room)}" is narrower than its ${spec.minDim / 1000} m minimum somewhere.`,
          [room.id],
        ),
      );
    }
  }

  // openings must fit their walls
  const wallById = new Map<string, Wall>(plan.walls.map((w) => [w.id, w]));
  for (const opening of [...plan.doors, ...plan.windows]) {
    const wall = wallById.get(opening.wallId);
    if (!wall) {
      out.push(
        violation('DOOR_TOO_WIDE_FOR_WALL', 'error', `An opening references a missing wall.`, [opening.id]),
      );
      continue;
    }
    const len = wallLength(wall);
    if (opening.t0 < 0 || opening.t0 * len + opening.width > len + 1) {
      out.push(
        violation('DOOR_TOO_WIDE_FOR_WALL', 'error', `An opening overflows its wall.`, [opening.id]),
      );
    }
  }

  // reachability via doors from outside
  out.push(...checkReachability(plan, nameOf));

  return out;
}

export function checkReachability(plan: PlanModel, nameOf: (room: PlanRoom) => string): Violation[] {
  if (plan.rooms.length === 0) return [];
  const reachable = new Set<string>();
  const queue: Array<string | 'outside'> = ['outside'];
  const adj = new Map<string | 'outside', Array<string | 'outside'>>();
  for (const door of plan.doors) {
    const [a, b] = door.connects;
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const visited = new Set<string | 'outside'>();
  while (queue.length > 0) {
    const node = queue.shift() as string | 'outside';
    if (visited.has(node)) continue;
    visited.add(node);
    if (node !== 'outside') reachable.add(node);
    for (const next of adj.get(node) ?? []) queue.push(next);
  }
  return plan.rooms
    .filter((room) => !reachable.has(room.id))
    .map((room) =>
      violation(
        'ROOM_UNREACHABLE',
        'error',
        `"${nameOf(room)}" cannot be reached through any door.`,
        [room.id],
      ),
    );
}

export const doorGraphHasEntrance = (doors: Door[]): boolean =>
  doors.some((d) => d.connects[1] === 'outside' || d.connects[0] === 'outside');
