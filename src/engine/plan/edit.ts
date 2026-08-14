// Interactive edits on a finished PlanModel. Every edit returns a FULLY
// rebuilt, revalidated PlanModel (or null when the edit would break the
// layout) — the UI never mutates plan geometry directly.

import { area2OfPoly, intersectionArea2 } from '../geometry/clip';
import type { Poly } from '../geometry/polygon';
import { normalizeRing } from '../geometry/polygon';
import { onSegment, type Vec } from '../geometry/vec';
import { mm, type Mm } from '../units';
import type { Plot } from '../plot/types';
import type { Program, RoomSpec } from '../program/types';
import { placeFurniture, swingObstructions } from './furniture';
import { postProcess } from './postprocess';
import type { Door, PlanModel } from './types';
import { validatePlan } from './validate';
import { wallLength } from './walls';

/**
 * Move an interior axis-aligned wall along its normal by `delta` mm.
 * Only the two flanking rooms change: their ring vertices lying on the wall
 * segment shift; rooms merely touching the wall's endpoints keep their
 * geometry (the tessellation stays valid — the boundary ownership just
 * changes). Returns null when the wall is not draggable or a flanking room
 * would collapse.
 */
export function moveWall(
  plan: PlanModel,
  program: Program,
  plot: Plot,
  wallId: string,
  delta: Mm,
): PlanModel | null {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall || wall.kind !== 'interior' || delta === 0) return null;
  const vertical = wall.a.x === wall.b.x;
  const horizontal = wall.a.y === wall.b.y;
  if (!vertical && !horizontal) return null; // diagonal walls are not draggable

  const flanking = [wall.leftRoomId, wall.rightRoomId].filter((x): x is string => x !== null);
  if (flanking.length !== 2) return null;

  const shift = (p: Vec): Vec =>
    vertical ? { x: mm(p.x + delta), y: p.y } : { x: p.x, y: mm(p.y + delta) };

  const specOf = new Map<string, RoomSpec>(program.rooms.map((r) => [r.id, r]));
  const cells: (Poly | null)[] = [];
  const roomSpecs: RoomSpec[] = [];
  const movedIdx: number[] = [];

  for (const room of plan.rooms) {
    const spec = specOf.get(room.specId);
    if (!spec) return null;
    roomSpecs.push(spec);
    if (!flanking.includes(room.id)) {
      cells.push(room.poly);
      continue;
    }
    const moveRing = (ring: Vec[]): Vec[] =>
      ring.map((p) => (onSegment(wall.a, wall.b, p) ? shift(p) : p));
    const outer = normalizeRing(moveRing(room.poly.outer));
    if (!outer) return null; // room collapsed
    const holes = room.poly.holes
      .map((h) => normalizeRing(moveRing(h)))
      .filter((h): h is NonNullable<typeof h> => h !== null);
    movedIdx.push(cells.length);
    cells.push({ outer, holes });
  }

  // A valid wall move transfers area between the two flanking rooms EXACTLY.
  // Anything else means the move nicked a corner-touching third room (gap) or
  // blew a room past its neighbors (overlap) — reject, never corrupt.
  const sumBefore = plan.rooms.reduce((s, r) => s + area2OfPoly(r.poly), 0);
  const sumAfter = cells.reduce((s, c) => s + (c ? area2OfPoly(c) : 0), 0);
  if (sumAfter !== sumBefore) return null;
  for (const i of movedIdx) {
    const moved = cells[i];
    if (!moved) return null;
    for (let j = 0; j < cells.length; j++) {
      if (j === i) continue;
      if (movedIdx.includes(j) && j < i) continue; // moved pair: check once
      const other = cells[j];
      if (other && intersectionArea2(moved, other) !== 0) return null;
    }
  }

  const rebuilt = postProcess({
    id: plan.id,
    seed: plan.seed,
    footprint: plan.footprint,
    rooms: roomSpecs,
    cells,
    slivers: [],
    scoreTerms: {
      areaFit: plan.metrics.areaFitScore,
      adjacency: plan.metrics.adjacencyScore,
      exposure: plan.metrics.daylightScore,
      total: plan.metrics.totalScore,
    },
    program,
    plot,
  });

  // reject edits that hard-break a flanking room (soft violations are fine —
  // they render as badges; collapse/vanish is not)
  if (rebuilt.rooms.length !== plan.rooms.length) return null;
  return rebuilt;
}

/**
 * Largest |delta| ≤ requested that produces a valid layout, by bisection.
 * Returns the rebuilt plan or null when even a minimal move fails.
 */
export function moveWallClamped(
  plan: PlanModel,
  program: Program,
  plot: Plot,
  wallId: string,
  requested: Mm,
): PlanModel | null {
  let attempt = requested;
  for (let i = 0; i < 4; i++) {
    const result = moveWall(plan, program, plot, wallId, attempt);
    if (result) return result;
    attempt = mm(attempt / 2);
    if (Math.abs(attempt) < 50) break;
  }
  return null;
}

/** Slide a door/window along its wall to parameter t0 (clamped to jambs). */
export function slideOpening(
  plan: PlanModel,
  program: Program,
  plot: Plot,
  openingId: string,
  t0: number,
): PlanModel | null {
  const wallOf = (wallId: string) => plan.walls.find((w) => w.id === wallId);
  const apply = <T extends { id: string; wallId: string; t0: number; width: Mm }>(list: T[]): T[] =>
    list.map((o) => {
      if (o.id !== openingId) return o;
      const wall = wallOf(o.wallId);
      if (!wall) return o;
      const len = wallLength(wall);
      const jamb = 100 / len;
      const maxT0 = 1 - o.width / len - jamb;
      return { ...o, t0: Math.min(Math.max(t0, jamb), Math.max(jamb, maxT0)) };
    });
  const doors = apply(plan.doors);
  const windows = apply(plan.windows);
  if (doors === plan.doors && windows === plan.windows) return null;
  return revalidated({ ...plan, doors, windows }, program, plot);
}

/** Flip a door's swing side. */
export function flipDoorSwing(
  plan: PlanModel,
  program: Program,
  plot: Plot,
  doorId: string,
): PlanModel | null {
  const doors: Door[] = plan.doors.map((d) =>
    d.id === doorId ? { ...d, swing: d.swing === 'left' ? 'right' : 'left' } : d,
  );
  return revalidated({ ...plan, doors }, program, plot);
}

function revalidated(plan: PlanModel, program: Program, _plot: Plot): PlanModel {
  const structural = plan.violations.filter(
    (v) => v.code === 'SLIVER_ROOM' || v.code === 'ENTRANCE_MOVED' || v.code === 'ROOM_NO_EXTERIOR_WALL',
  );
  // Furniture follows the user's door edits — doors stay EXACTLY as edited
  // (no Do07 auto-mirror here: it would undo the user's own slide/flip);
  // residual swing overlaps are reported, not fixed.
  const specById = new Map(program.rooms.map((s) => [s.id, s]));
  const furniture = placeFurniture(plan.rooms, plan.walls, plan.doors, plan.windows, specById);
  const nameOfRoom = (roomId: string): string => {
    const room = plan.rooms.find((r) => r.id === roomId);
    return (room && specById.get(room.specId)?.name) || roomId;
  };
  const next: PlanModel = { ...plan, furniture: furniture.items };
  next.violations = [
    ...structural,
    ...furniture.violations,
    ...swingObstructions(plan.doors, plan.walls, furniture.items, nameOfRoom),
    ...validatePlan(next, program),
  ];
  return next;
}
