// Door and window placement.
// Doors: entrance first (exterior wall nearest the plot's entrance hint,
// preferring near-entrance rooms), then doors for required/preferred
// adjacencies, then spanning doors until every room is reachable. A door
// needs jambs; too-short walls shrink the door stepwise to 700 mm before
// giving up with a violation. Windows: one per daylight room on its longest
// exterior wall.

import { lerp, type Vec } from '../geometry/vec';
import { mm } from '../units';
import { violation, type Violation } from '../violations';
import { ROOM_TYPE_DEFAULTS } from '../program/defaults';
import { DOOR_JAMB, DOOR_MIN_WIDTH, type Program, type RoomSpec } from '../program/types';
import type { Plot } from '../plot/types';
import type { Door, PlanRoom, Wall, Window } from './types';
import { wallLength } from './walls';

export interface OpeningsResult {
  doors: Door[];
  windows: Window[];
  violations: Violation[];
}

export function placeOpenings(
  rooms: PlanRoom[],
  walls: Wall[],
  program: Program,
  plot: Plot,
): OpeningsResult {
  const doors: Door[] = [];
  const violations: Violation[] = [];
  const specOf = new Map<string, RoomSpec>(program.rooms.map((r) => [r.id, r]));
  const specIdOf = new Map<string, string>(rooms.map((r) => [r.id, r.specId]));
  const nameOf = (roomId: string): string => {
    const spec = specOf.get(specIdOf.get(roomId) ?? '');
    return spec?.name ?? roomId;
  };

  const doorWidth = program.defaults.doorWidth;
  let doorIndex = 0;
  let windowIndex = 0;

  /** Fit an opening of preferred width on a wall; shrink to the minimum. */
  const fitOpening = (wall: Wall, preferred: number, minimum: number): { t0: number; width: number } | null => {
    const len = wallLength(wall);
    for (let width = preferred; width >= minimum; width -= 50) {
      if (len >= width + 2 * DOOR_JAMB) {
        const t0 = (len - width) / 2 / len;
        return { t0, width };
      }
    }
    return null;
  };

  // Swing convention: a door opens INTO the room it serves — the more
  // private side — and never into circulation. Rank: bathroom/wc/storage >
  // bedroom > kitchen/other/balcony > living > hall; area breaks ties.
  // 'outside' always loses (entrance doors open inward).
  const SWING_RANK: Record<string, number> = {
    bathroom: 4,
    wc: 4,
    storage: 4,
    bedroom: 3,
    kitchen: 2,
    other: 2,
    balcony: 2,
    living: 1,
    hall: 0,
  };
  const swingScore = (roomId: string | null): [number, number] => {
    if (roomId === null) return [-1, -Infinity];
    const room = rooms.find((r) => r.id === roomId);
    const spec = room ? specOf.get(room.specId) : undefined;
    return [SWING_RANK[spec?.type ?? 'other'] ?? 2, room?.grossArea ?? 0];
  };

  const addDoor = (wall: Wall, connects: [string, string | 'outside']): boolean => {
    const fit = fitOpening(wall, doorWidth, DOOR_MIN_WIDTH);
    if (!fit) return false;
    const [leftRank, leftArea] = swingScore(wall.leftRoomId);
    const [rightRank, rightArea] = swingScore(wall.rightRoomId);
    const intoLeft = leftRank > rightRank || (leftRank === rightRank && leftArea >= rightArea);
    doors.push({
      id: `d${doorIndex++}`,
      wallId: wall.id,
      t0: fit.t0,
      width: mm(fit.width),
      swing: intoLeft ? 'left' : 'right',
      connects,
    });
    return true;
  };

  // --- entrance door ---
  const exteriorWallsOf = (roomId: string): Wall[] =>
    walls.filter(
      (w) => w.kind === 'exterior' && (w.leftRoomId === roomId || w.rightRoomId === roomId),
    );

  const entrancePoint = ((): Vec | null => {
    if (!plot.entrance) return null;
    const a = plot.boundary[plot.entrance.edgeIndex];
    const b = plot.boundary[(plot.entrance.edgeIndex + 1) % plot.boundary.length];
    return a && b ? lerp(a, b, plot.entrance.t) : null;
  })();

  const entranceCandidates = rooms
    .map((room) => {
      const spec = specOf.get(room.specId);
      const wallsExt = exteriorWallsOf(room.id).filter((w) => wallLength(w) >= DOOR_MIN_WIDTH + 2 * DOOR_JAMB);
      const best = wallsExt.sort((x, y) => {
        if (!entrancePoint) return wallLength(y) - wallLength(x);
        const mid = (w: Wall): Vec => lerp(w.a, w.b, 0.5);
        const dx = (w: Wall) => {
          const m = mid(w);
          return Math.hypot(m.x - entrancePoint.x, m.y - entrancePoint.y);
        };
        return dx(x) - dx(y);
      })[0];
      if (!best) return null;
      const priority = (spec?.prefs.nearEntrance ? 0 : 1) + (spec?.type === 'hall' ? 0 : 0.5);
      return { room, wall: best, priority };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.priority - b.priority);

  const entrance = entranceCandidates[0] ?? null;
  if (entrance) {
    addDoor(entrance.wall, [entrance.room.id, 'outside']);
    if (entrancePoint) {
      const mid = lerp(entrance.wall.a, entrance.wall.b, 0.5);
      const moved = Math.hypot(mid.x - entrancePoint.x, mid.y - entrancePoint.y);
      if (moved > 2_000) {
        violations.push(
          violation(
            'ENTRANCE_MOVED',
            'info',
            `The entrance was placed ${(moved / 1000).toFixed(1)} m from your marker to land on a suitable wall.`,
            [entrance.room.id],
          ),
        );
      }
    }
  }

  // --- interior doors ---
  const interiorWallsBetween = (roomA: string, roomB: string): Wall[] =>
    walls
      .filter(
        (w) =>
          w.kind === 'interior' &&
          ((w.leftRoomId === roomA && w.rightRoomId === roomB) ||
            (w.leftRoomId === roomB && w.rightRoomId === roomA)),
      )
      .sort((x, y) => wallLength(y) - wallLength(x));

  const doorExistsBetween = (roomA: string, roomB: string): boolean =>
    doors.some(
      (d) =>
        (d.connects[0] === roomA && d.connects[1] === roomB) ||
        (d.connects[0] === roomB && d.connects[1] === roomA),
    );

  const tryConnect = (roomA: string, roomB: string): boolean => {
    if (doorExistsBetween(roomA, roomB)) return true;
    for (const wall of interiorWallsBetween(roomA, roomB)) {
      if (addDoor(wall, [roomA, roomB])) return true;
    }
    return false;
  };

  // doors for explicit adjacency wishes (required first, then preferred)
  const roomIdOfSpec = new Map<string, string>(rooms.map((r) => [r.specId, r.id]));
  const wished = [...program.adjacency]
    .filter((rule) => rule.kind !== 'avoid')
    .sort((a, b) => (a.kind === 'required' ? 0 : 1) - (b.kind === 'required' ? 0 : 1));
  for (const rule of wished) {
    const a = roomIdOfSpec.get(rule.a);
    const b = roomIdOfSpec.get(rule.b);
    if (!a || !b) continue;
    if (interiorWallsBetween(a, b).length > 0 && !tryConnect(a, b) && rule.kind === 'required') {
      violations.push(
        violation(
          'DOOR_TOO_WIDE_FOR_WALL',
          'warning',
          `No door fits between "${nameOf(a)}" and "${nameOf(b)}" — their shared wall is shorter than ${(DOOR_MIN_WIDTH + 2 * DOOR_JAMB) / 1000} m.`,
          [a, b],
        ),
      );
    }
  }

  // spanning doors until connected (BFS from the entrance room)
  const connectivityPass = (): void => {
    const reachable = new Set<string>();
    if (entrance) reachable.add(entrance.room.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const door of doors) {
        const [a, b] = door.connects;
        const aIn = a !== 'outside' && reachable.has(a);
        const bIn = b !== 'outside' && reachable.has(b);
        if (aIn && b !== 'outside' && !reachable.has(b)) {
          reachable.add(b);
          grew = true;
        }
        if (bIn && a !== 'outside' && !reachable.has(a)) {
          reachable.add(a);
          grew = true;
        }
      }
    }
    // connect the unreachable room with the longest wall to the reachable set
    const unreachable = rooms.filter((r) => !reachable.has(r.id));
    for (const room of unreachable) {
      const candidates = walls
        .filter(
          (w) =>
            w.kind === 'interior' &&
            ((w.leftRoomId === room.id && w.rightRoomId && reachable.has(w.rightRoomId)) ||
              (w.rightRoomId === room.id && w.leftRoomId && reachable.has(w.leftRoomId))),
        )
        .sort((x, y) => wallLength(y) - wallLength(x));
      for (const wall of candidates) {
        const other = wall.leftRoomId === room.id ? wall.rightRoomId : wall.leftRoomId;
        if (other && addDoor(wall, [room.id, other])) {
          reachable.add(room.id);
          // rooms beyond this one may now be reachable; restart outer pass
          connectivityPass();
          return;
        }
      }
    }
  };
  if (entrance) connectivityPass();

  // --- windows ---
  const windows: Window[] = [];
  for (const room of rooms) {
    const spec = specOf.get(room.specId);
    if (!spec) continue;
    const wants = spec.prefs.exteriorWall ?? ROOM_TYPE_DEFAULTS[spec.type].needsDaylight;
    if (!wants) continue;
    const doorWallIds = new Set(doors.map((d) => d.wallId));
    const ext = exteriorWallsOf(room.id)
      .filter((w) => !doorWallIds.has(w.id))
      .sort((x, y) => wallLength(y) - wallLength(x))[0];
    if (!ext) {
      violations.push(
        violation(
          'ROOM_NO_EXTERIOR_WALL',
          'warning',
          `"${spec.name}" wants daylight but has no exterior wall in this layout.`,
          [room.id],
        ),
      );
      continue;
    }
    const fit = fitOpening(ext, program.defaults.windowWidth, 600);
    if (fit) {
      windows.push({ id: `n${windowIndex++}`, wallId: ext.id, t0: fit.t0, width: mm(fit.width) });
    }
  }

  return { doors, windows, violations };
}
