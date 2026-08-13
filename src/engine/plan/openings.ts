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

  // Spanning doors via hub-routed shortest paths (NOT greedy longest-wall):
  // traversal cost makes halls free corridors, living cheap, kitchens
  // tolerable, and private rooms expensive — so bedrooms/bathrooms become
  // LEAVES of the door tree and nobody walks through a bedroom to reach a
  // bathroom unless geometry truly forces it (then it's flagged).
  const transitCost = (roomId: string): number => {
    const spec = specOf.get(specIdOf.get(roomId) ?? '');
    switch (spec?.type) {
      case 'hall':
        return 0;
      case 'living':
        return 0.3;
      case 'kitchen':
      case 'other':
        return 1.5;
      default:
        return 6; // bedrooms, bathrooms, wc, storage, balcony: transit of last resort
    }
  };

  const connectivityPass = (): void => {
    if (!entrance) return;
    // candidate edges: every room pair with a door-able shared wall
    interface Edge {
      to: string;
      wall: Wall;
    }
    const edges = new Map<string, Edge[]>();
    for (const wall of walls) {
      if (wall.kind !== 'interior' || !wall.leftRoomId || !wall.rightRoomId) continue;
      if (wallLength(wall) < DOOR_MIN_WIDTH + 2 * DOOR_JAMB) continue;
      edges.set(wall.leftRoomId, [...(edges.get(wall.leftRoomId) ?? []), { to: wall.rightRoomId, wall }]);
      edges.set(wall.rightRoomId, [...(edges.get(wall.rightRoomId) ?? []), { to: wall.leftRoomId, wall }]);
    }

    // Dijkstra from the entrance room; existing doors (entrance, wishes) are
    // free edges — they're already built
    const dist = new Map<string, number>();
    const parent = new Map<string, { from: string; wall: Wall | null }>();
    const done = new Set<string>();
    dist.set(entrance.room.id, 0);
    while (true) {
      let current: string | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!done.has(id) && d < best) {
          best = d;
          current = id;
        }
      }
      if (current === null) break;
      done.add(current);
      const through = transitCost(current);
      const relax = (to: string, wall: Wall | null, extra: number) => {
        const cand = best + through + extra;
        if (cand < (dist.get(to) ?? Infinity)) {
          dist.set(to, cand);
          parent.set(to, { from: current as string, wall });
        }
      };
      for (const door of doors) {
        const [a, b] = door.connects;
        if (a === current && b !== 'outside') relax(b, null, 0);
        if (b === current && a !== 'outside') relax(a, null, 0);
      }
      for (const edge of edges.get(current) ?? []) {
        relax(edge.to, edge.wall, 1);
      }
    }

    // materialize tree edges as doors, nearest rooms first
    const order = [...dist.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    for (const roomId of order) {
      const p = parent.get(roomId);
      if (!p || p.wall === null) continue; // entrance room or already-doored edge
      if (!doorExistsBetween(roomId, p.from) && !addDoor(p.wall, [roomId, p.from])) {
        tryConnect(roomId, p.from);
      }
    }

    // anything Dijkstra never reached has no door-able wall to the reachable
    // set at all — fall back to ANY shared wall so validate/repair can report
    for (const room of rooms) {
      if (dist.has(room.id)) continue;
      const fallback = walls
        .filter(
          (w) =>
            w.kind === 'interior' &&
            ((w.leftRoomId === room.id && w.rightRoomId) || (w.rightRoomId === room.id && w.leftRoomId)),
        )
        .sort((x, y) => wallLength(y) - wallLength(x));
      for (const wall of fallback) {
        const other = wall.leftRoomId === room.id ? wall.rightRoomId : wall.leftRoomId;
        if (other && addDoor(wall, [room.id, other])) break;
      }
    }

    // flag door paths that transit private rooms — geometry forced it
    for (const roomId of order) {
      let cursor = parent.get(roomId);
      while (cursor) {
        const throughSpec = specOf.get(specIdOf.get(cursor.from) ?? '');
        if (cursor.from !== entrance.room.id && throughSpec && transitCost(cursor.from) >= 6) {
          violations.push(
            violation(
              'PRIVATE_TRANSIT',
              'warning',
              `"${nameOf(roomId)}" is only reachable through "${throughSpec.name}" — no hallway connection fits.`,
              [roomId, cursor.from],
            ),
          );
          break;
        }
        cursor = parent.get(cursor.from);
      }
    }
  };
  connectivityPass();

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
