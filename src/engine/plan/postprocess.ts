// Post-process a solved candidate into a full PlanModel:
// absorb slivers → extract walls → place openings → validate → repair →
// net areas + metrics. Everything deterministic; ids derive from stable
// ordering, never from randomness.

import { area2OfPoly, unionPolys } from '../geometry/clip';
import { sharedBoundaryLength } from '../geometry/measure';
import type { Poly } from '../geometry/polygon';
import { mm2, type Mm2 } from '../units';
import { violation, type Violation } from '../violations';
import type { Plot } from '../plot/types';
import type { Program, RoomSpec } from '../program/types';
import type { Metrics, PlanModel, PlanRoom } from './types';
import { checkFurnishability } from './furnish';
import { placeOpenings } from './openings';
import { validatePlan } from './validate';
import { extractWalls, wallLength } from './walls';

export interface PostProcessInput {
  id: string;
  seed: number;
  footprint: Poly;
  rooms: RoomSpec[];
  cells: (Poly | null)[];
  slivers: Poly[];
  scoreTerms: {
    areaFit: number;
    adjacency: number;
    exposure: number;
    total: number;
    circulation?: number;
    wetCluster?: number;
    entrance?: number;
  };
  program: Program;
  plot: Plot;
}

const SLIVER_MAX_AREA2 = 2 * 500_000; // 0.5 m²

export function postProcess(input: PostProcessInput): PlanModel {
  const { id, seed, footprint, rooms, program, plot, scoreTerms } = input;
  const violations: Violation[] = [];

  // --- absorb slivers into the neighbor with the longest shared boundary ---
  const cells: Poly[] = [];
  const cellRooms: RoomSpec[] = [];
  input.cells.forEach((cell, i) => {
    if (cell) {
      cells.push(cell);
      cellRooms.push(rooms[i] as RoomSpec);
    }
  });
  let orphanArea = 0;
  for (const sliver of input.slivers) {
    let bestIdx = -1;
    let bestShared = 0;
    for (let i = 0; i < cells.length; i++) {
      const shared = sharedBoundaryLength(sliver, cells[i] as Poly);
      if (shared > bestShared) {
        bestShared = shared;
        bestIdx = i;
      }
    }
    const canAbsorb =
      bestIdx >= 0 &&
      (area2OfPoly(sliver) <= SLIVER_MAX_AREA2 ||
        area2OfPoly(cells[bestIdx] as Poly) + area2OfPoly(sliver) <=
          2 * (cellRooms[bestIdx] as RoomSpec).area.max * 1.1);
    if (canAbsorb) {
      const merged = unionPolys([cells[bestIdx] as Poly, sliver]);
      if (merged.length === 1) {
        cells[bestIdx] = merged[0] as Poly;
        continue;
      }
    }
    orphanArea += area2OfPoly(sliver);
  }
  if (orphanArea > 0) {
    violations.push(
      violation(
        'SLIVER_ROOM',
        'warning',
        `${(orphanArea / 2 / 1e6).toFixed(2)} m² of the footprint could not be attached to any room.`,
        [id],
      ),
    );
  }

  // --- plan rooms ---
  const planRooms: PlanRoom[] = cells.map((cell, i) => ({
    id: `${id}-r${i}`,
    specId: (cellRooms[i] as RoomSpec).id,
    poly: cell,
    grossArea: mm2(area2OfPoly(cell) / 2),
    netArea: mm2(area2OfPoly(cell) / 2), // refined below from walls
  }));

  // --- walls & openings ---
  const walls = extractWalls(planRooms, footprint, program.defaults);
  const openings = placeOpenings(planRooms, walls, program, plot);
  violations.push(...openings.violations);

  // --- furnishability (design_rules_v4 §14): warn when the standard
  // furniture set cannot stand in a room clear of door swings ---
  const specById = new Map<string, RoomSpec>(program.rooms.map((s) => [s.id, s]));
  violations.push(...checkFurnishability(planRooms, walls, openings.doors, specById));

  // --- net areas: gross − Σ (wall length × thickness/2) per flanking room ---
  const insetByRoom = new Map<string, number>();
  for (const wall of walls) {
    const len = wallLength(wall);
    for (const roomId of [wall.leftRoomId, wall.rightRoomId]) {
      if (roomId) insetByRoom.set(roomId, (insetByRoom.get(roomId) ?? 0) + (len * wall.thickness) / 2);
    }
  }
  for (const room of planRooms) {
    const inset = insetByRoom.get(room.id) ?? 0;
    room.netArea = mm2(Math.max(0, room.grossArea - inset));
  }

  // --- metrics ---
  const grossFloorArea = mm2(area2OfPoly(footprint) / 2);
  const netRoomArea = mm2(planRooms.reduce((s, r) => s + r.netArea, 0));
  const hallArea = planRooms
    .filter((r) => program.rooms.find((s) => s.id === r.specId)?.type === 'hall')
    .reduce((s, r) => s + r.netArea, 0);
  const metrics: Metrics = {
    grossFloorArea,
    netRoomArea,
    circulationArea: mm2(hallArea) as Mm2,
    efficiency: grossFloorArea > 0 ? netRoomArea / grossFloorArea : 0,
    adjacencyScore: scoreTerms.adjacency,
    areaFitScore: scoreTerms.areaFit,
    daylightScore: scoreTerms.exposure,
    totalScore: scoreTerms.total,
    ...(scoreTerms.circulation !== undefined ? { circulationScore: scoreTerms.circulation } : {}),
    ...(scoreTerms.wetCluster !== undefined ? { wetClusterScore: scoreTerms.wetCluster } : {}),
    ...(scoreTerms.entrance !== undefined ? { entranceScore: scoreTerms.entrance } : {}),
  };

  const plan: PlanModel = {
    id,
    seed,
    footprint,
    rooms: planRooms,
    walls,
    doors: openings.doors,
    windows: openings.windows,
    violations,
    metrics,
  };

  // --- validate + attach ---
  plan.violations = [...violations, ...validatePlan(plan, program)];
  return plan;
}
