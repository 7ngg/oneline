// Deterministic furniture placement (design_rules_v4 §14). Wall-strip
// primitive: a candidate is a rectangle extruded inward from a wall run,
// validated by exact integer containment, collision-checked against door
// swings (+ F04 100 mm buffer), window spans (tall pieces only — D01) and
// already-placed items. Pure and RNG-free: same plan in, same items out.
// Determinism discipline: integer |dx|+|dy| lengths, explicit wall-id
// tie-breaks, item coords from integer endpoint arithmetic, per-room ids.
//
// Do07 lives here too: resolveSwingConflicts mirrors a door to its wall's
// other end when the swing sweeps furniture (a pure hinge flip would be a
// geometric no-op — both hinge ends sweep inside the same span×width
// square). Callers re-place furniture once after flips with doors frozen.

import { pointInPoly, ringBbox, type Poly } from '../geometry/polygon';
import type { Vec } from '../geometry/vec';
import { mm, type Mm } from '../units';
import { violation, type Violation } from '../violations';
import type { RoomSpec } from '../program/types';
import type { Door, FurnitureItem, FurnitureKind, PlanRoom, Wall, Window } from './types';

export interface PlacementResult {
  items: FurnitureItem[];
  violations: Violation[];
  /** Primary pieces attempted / placed — feeds the selection furnish ratio. */
  primaryCount: number;
  primaryPlaced: number;
}

export interface PlaceOptions {
  /** Selection pre-pass: place only the primary piece per room. */
  primariesOnly?: boolean;
}

// F01/F04 clearances and W04/W05/W07 fixture sizes, mm
const F04_DOOR_BUFFER = 100;
const WINDOW_TALL_MARGIN = 150;
const BED_SIDE_CLEARANCE = 500; // F01: 50 cm alongside a bed
const TOILET_SIDE_CLEARANCE = 250;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A room-side wall segment with its inward direction resolved. */
interface Run {
  wall: Wall;
  horizontal: boolean;
  /** Along-axis span [lo, hi] (x for horizontal walls, y for vertical). */
  lo: number;
  hi: number;
  /** The wall's perpendicular coordinate. */
  base: number;
  /** Inward step sign along the perpendicular axis. */
  inward: 1 | -1;
  exterior: boolean;
  /** Blocked along-axis intervals: door spans + F04. */
  doorSpans: Array<[number, number]>;
  /** Window spans (block tall pieces; low pieces may sit under them). */
  windowSpans: Array<[number, number]>;
}

const runLength = (r: Run): number => r.hi - r.lo;

/** Along-axis interval of an opening on its wall, integer-rounded outward. */
const openingSpan = (wall: Wall, t0: number, width: number, horizontal: boolean): [number, number] => {
  const a = horizontal ? wall.a.x : wall.a.y;
  const b = horizontal ? wall.b.x : wall.b.y;
  const s0 = a + (b - a) * t0;
  const s1 = s0 + Math.sign(b - a) * width;
  return [Math.floor(Math.min(s0, s1)), Math.ceil(Math.max(s0, s1))];
};

interface RoomContext {
  room: PlanRoom;
  spec: RoomSpec;
  bbox: Box;
  /** Reflex (concave) vertices of the outer ring — containment probes. */
  reflex: Vec[];
  rectilinear: boolean;
  runs: Run[];
  occupied: Box[];
  items: FurnitureItem[];
  nextId: number;
}

/** Exact containment of an axis-aligned box in a rectilinear room poly. */
const boxInsideRoom = (ctx: RoomContext, box: Box): boolean => {
  const { bbox } = ctx;
  if (box.x0 < bbox.x0 || box.y0 < bbox.y0 || box.x1 > bbox.x1 || box.y1 > bbox.y1) return false;
  // fast path: the room IS its bbox
  if (ctx.reflex.length === 0 && ctx.room.poly.holes.length === 0) return true;
  // rectilinear poly: box ⊆ poly ⟺ all 4 corners inside/boundary AND no
  // reflex vertex strictly inside the box (an axis-aligned boundary can only
  // intrude through a reflex corner or past a box corner)
  const corners: Vec[] = [
    { x: box.x0, y: box.y0 } as Vec,
    { x: box.x1, y: box.y0 } as Vec,
    { x: box.x1, y: box.y1 } as Vec,
    { x: box.x0, y: box.y1 } as Vec,
  ];
  for (const c of corners) {
    if (pointInPoly(c, ctx.room.poly) === 'outside') return false;
  }
  for (const v of ctx.reflex) {
    if (v.x > box.x0 && v.x < box.x1 && v.y > box.y0 && v.y < box.y1) return false;
  }
  return true;
};

const reflexVertices = (poly: Poly): Vec[] => {
  const ring = poly.outer; // normalized CCW
  const out: Vec[] = [];
  for (let i = 0; i < ring.length; i++) {
    const u = ring[(i + ring.length - 1) % ring.length] as Vec;
    const v = ring[i] as Vec;
    const w = ring[(i + 1) % ring.length] as Vec;
    const cross = (v.x - u.x) * (w.y - v.y) - (v.y - u.y) * (w.x - v.x);
    if (cross < 0) out.push(v);
  }
  return out;
};

/** Swing square of a hinged door: opening span × door width toward the served side. */
export const doorSwingBox = (door: Door, wall: Wall): Box | null => {
  if ((door.kind ?? 'door') !== 'door') return null;
  const horizontal = wall.a.y === wall.b.y;
  if (!horizontal && wall.a.x !== wall.b.x) return null;
  const [s0, s1] = openingSpan(wall, door.t0, door.width, horizontal);
  // served side: swing 'left' opens into wall.leftRoomId's side
  const servedLeft = door.swing === 'left';
  if (horizontal) {
    const dx = Math.sign(wall.b.x - wall.a.x);
    const up = servedLeft ? dx > 0 : dx < 0; // left normal of a→b is (0, dx)
    const y0 = up ? wall.a.y : wall.a.y - door.width;
    return { x0: s0, x1: s1, y0, y1: y0 + door.width };
  }
  const dy = Math.sign(wall.b.y - wall.a.y);
  const right = servedLeft ? dy < 0 : dy > 0; // left normal of a→b is (−dy, 0)
  const x0 = right ? wall.a.x : wall.a.x - door.width;
  return { x0, x1: x0 + door.width, y0: s0, y1: s1 };
};

const buildContext = (
  room: PlanRoom,
  spec: RoomSpec,
  walls: Wall[],
  doors: Door[],
  windows: Window[],
): RoomContext | null => {
  const bb = ringBbox(room.poly.outer);
  const ctx: RoomContext = {
    room,
    spec,
    bbox: { x0: bb.minX, y0: bb.minY, x1: bb.maxX, y1: bb.maxY },
    reflex: reflexVertices(room.poly),
    rectilinear: room.poly.outer.every((p, i, ring) => {
      const q = ring[(i + 1) % ring.length] as Vec;
      return p.x === q.x || p.y === q.y;
    }),
    runs: [],
    occupied: [],
    items: [],
    nextId: 0,
  };
  if (!ctx.rectilinear) return null; // silent skip — diagonal rooms are rare

  const wallById = new Map(walls.map((w) => [w.id, w]));
  for (const wall of walls) {
    const isLeft = wall.leftRoomId === room.id;
    const isRight = wall.rightRoomId === room.id;
    if (!isLeft && !isRight) continue;
    const horizontal = wall.a.y === wall.b.y;
    if (!horizontal && wall.a.x !== wall.b.x) continue;
    let inward: 1 | -1;
    if (horizontal) {
      const dx = Math.sign(wall.b.x - wall.a.x) as 1 | -1;
      inward = isLeft ? dx : (-dx as 1 | -1); // left normal of a→b is (0, dx)
    } else {
      const dy = Math.sign(wall.b.y - wall.a.y) as 1 | -1;
      inward = isLeft ? (-dy as 1 | -1) : dy; // left normal of a→b is (−dy, 0)
    }
    const run: Run = {
      wall,
      horizontal,
      lo: horizontal ? Math.min(wall.a.x, wall.b.x) : Math.min(wall.a.y, wall.b.y),
      hi: horizontal ? Math.max(wall.a.x, wall.b.x) : Math.max(wall.a.y, wall.b.y),
      base: horizontal ? wall.a.y : wall.a.x,
      inward,
      exterior: wall.kind === 'exterior',
      doorSpans: [],
      windowSpans: [],
    };
    ctx.runs.push(run);
  }
  // deterministic: longest first, wall id breaks ties
  ctx.runs.sort((r1, r2) => runLength(r2) - runLength(r1) || (r1.wall.id < r2.wall.id ? -1 : 1));

  for (const door of doors) {
    const wall = wallById.get(door.wallId);
    if (!wall || (wall.leftRoomId !== room.id && wall.rightRoomId !== room.id)) continue;
    const run = ctx.runs.find((r) => r.wall.id === wall.id);
    if (!run) continue;
    const [s0, s1] = openingSpan(wall, door.t0, door.width, run.horizontal);
    run.doorSpans.push([s0 - F04_DOOR_BUFFER, s1 + F04_DOOR_BUFFER]);
    const swing = doorSwingBox(door, wall);
    if (swing) {
      // the swing square only occupies THIS room when it sweeps inward here
      const inRoom = run.horizontal
        ? run.inward > 0
          ? swing.y0 >= run.base
          : swing.y1 <= run.base
        : run.inward > 0
          ? swing.x0 >= run.base
          : swing.x1 <= run.base;
      if (inRoom) ctx.occupied.push(swing);
    }
  }
  for (const win of windows) {
    const wall = wallById.get(win.wallId);
    if (!wall || (wall.leftRoomId !== room.id && wall.rightRoomId !== room.id)) continue;
    const run = ctx.runs.find((r) => r.wall.id === wall.id);
    if (!run) continue;
    run.windowSpans.push(openingSpan(wall, win.t0, win.width, run.horizontal));
  }
  return ctx;
};

const spanBlocked = (spans: Array<[number, number]>, s0: number, s1: number): boolean =>
  spans.some(([a, b]) => s0 < b && a < s1);

interface FitOpts {
  prefer: 'center' | 'start' | 'end';
  /** Tall piece: window spans (+margin) block it (D01). */
  tall?: boolean;
  /** Extra clear width required either side of the piece (search only). */
  sideClearance?: number;
  /** Along-axis intervals to avoid beyond doors/windows (e.g. F03 bed vs window span). */
  avoidSpans?: Array<[number, number]>;
}

const STEP = 100;

/** Try to stand a w×d piece against a run; returns the item box or null. */
const fitOnRun = (ctx: RoomContext, run: Run, w: number, d: number, opts: FitOpts): Box | null => {
  const slack = opts.sideClearance ?? 0;
  const usable = runLength(run) - w - 2 * slack;
  if (usable < 0) return null;
  const sLo = run.lo + slack;
  const sHi = run.hi - slack - w;
  const positions: number[] = [];
  if (opts.prefer === 'center') {
    const mid = sLo + Math.round(usable / 2 / 50) * 50;
    positions.push(mid);
    for (let off = STEP; off <= usable / 2 + STEP && positions.length < 80; off += STEP) {
      if (mid - off >= sLo) positions.push(mid - off);
      if (mid + off <= sHi) positions.push(mid + off);
    }
  } else if (opts.prefer === 'start') {
    for (let s = sLo; s <= sHi && positions.length < 80; s += STEP) positions.push(s);
  } else {
    for (let s = sHi; s >= sLo && positions.length < 80; s -= STEP) positions.push(s);
  }
  for (const s of positions) {
    const s0 = s;
    const s1 = s + w;
    if (spanBlocked(run.doorSpans, s0 - slack, s1 + slack)) continue;
    if (opts.tall && spanBlocked(run.windowSpans, s0 - WINDOW_TALL_MARGIN, s1 + WINDOW_TALL_MARGIN)) continue;
    if (opts.avoidSpans && spanBlocked(opts.avoidSpans, s0, s1)) continue;
    const box: Box = run.horizontal
      ? {
          x0: s0,
          x1: s1,
          y0: run.inward > 0 ? run.base : run.base - d,
          y1: run.inward > 0 ? run.base + d : run.base,
        }
      : {
          y0: s0,
          y1: s1,
          x0: run.inward > 0 ? run.base : run.base - d,
          x1: run.inward > 0 ? run.base + d : run.base,
        };
    if (!boxInsideRoom(ctx, box)) continue;
    if (ctx.occupied.some((o) => overlaps(o, box))) continue;
    return box;
  }
  return null;
};

const FACING: Record<'h+' | 'h-' | 'v+' | 'v-', FurnitureItem['facing']> = {
  'h+': 'N',
  'h-': 'S',
  'v+': 'E',
  'v-': 'W',
};

const commit = (ctx: RoomContext, run: Run, kind: FurnitureKind, box: Box): FurnitureItem => {
  const item: FurnitureItem = {
    id: `${ctx.room.id}-f${ctx.nextId++}`,
    roomId: ctx.room.id,
    kind,
    x: mm(box.x0),
    y: mm(box.y0),
    w: mm(box.x1 - box.x0) as Mm,
    h: mm(box.y1 - box.y0) as Mm,
    facing: FACING[`${run.horizontal ? 'h' : 'v'}${run.inward > 0 ? '+' : '-'}` as keyof typeof FACING],
  };
  ctx.items.push(item);
  ctx.occupied.push(box);
  return item;
};

/** First run (given order) that fits the piece; commits and returns it. */
const placeOnAny = (
  ctx: RoomContext,
  runs: Run[],
  kind: FurnitureKind,
  w: number,
  d: number,
  opts: FitOpts,
): FurnitureItem | null => {
  for (const run of runs) {
    const box = fitOnRun(ctx, run, w, d, opts);
    if (box) return commit(ctx, run, kind, box);
  }
  return null;
};

interface PlannerOut {
  /** Primary piece + human label for the UNFIT message; null = no primary for this type. */
  primary: { placed: boolean; label: string; w: number; d: number } | null;
}

/** Squared Euclidean distance (exact integer — coords ≤ 1e7 so dx² < 2^53)
 *  from a run's midpoint to the nearest door span midpoint. */
const distanceFromDoors = (ctx: RoomContext, run: Run): number => {
  const doorMids: Vec[] = [];
  for (const r of ctx.runs) {
    for (const [a, b] of r.doorSpans) {
      const mid = Math.round((a + b) / 2);
      doorMids.push(
        r.horizontal ? ({ x: mid, y: r.base } as Vec) : ({ x: r.base, y: mid } as Vec),
      );
    }
  }
  if (doorMids.length === 0) return 0;
  const mid: Vec = run.horizontal
    ? ({ x: Math.round((run.lo + run.hi) / 2), y: run.base } as Vec)
    : ({ x: run.base, y: Math.round((run.lo + run.hi) / 2) } as Vec);
  let best = Infinity;
  for (const d of doorMids) {
    const dist = (mid.x - d.x) * (mid.x - d.x) + (mid.y - d.y) * (mid.y - d.y);
    if (dist < best) best = dist;
  }
  return best;
};

const planBedroom = (ctx: RoomContext, primariesOnly: boolean): PlannerOut => {
  const grossM2 = ctx.room.grossArea / 1e6;
  const double = grossM2 >= 12;
  const bedW = double ? 1600 : 900;
  const bedD = 2000;
  // F06: headboard on the wall farthest from the door; F03: avoid the window
  // SPAN, not the whole windowed wall — windowless walls first, then off-span
  const byDistance = [...ctx.runs].sort(
    (a, b) =>
      distanceFromDoors(ctx, b) - distanceFromDoors(ctx, a) || (a.wall.id < b.wall.id ? -1 : 1),
  );
  const windowless = byDistance.filter((r) => r.windowSpans.length === 0);
  const windowed = byDistance.filter((r) => r.windowSpans.length > 0);
  let bedRun: Run | null = null;
  let bedBox: Box | null = null;
  for (const run of [...windowless, ...windowed]) {
    const box = fitOnRun(ctx, run, bedW, bedD, {
      prefer: 'center',
      sideClearance: BED_SIDE_CLEARANCE,
      avoidSpans: run.windowSpans, // F03: never directly against a window
    });
    if (box) {
      bedRun = run;
      bedBox = box;
      break;
    }
  }
  // fallback: accept a window-span position rather than no bed at all
  if (!bedBox) {
    for (const run of byDistance) {
      const box = fitOnRun(ctx, run, bedW, bedD, { prefer: 'center', sideClearance: BED_SIDE_CLEARANCE });
      if (box) {
        bedRun = run;
        bedBox = box;
        break;
      }
    }
  }
  if (bedBox && bedRun) commit(ctx, bedRun, double ? 'bed-double' : 'bed-single', bedBox);
  const primary = {
    placed: bedBox !== null,
    label: double ? 'a double bed with side passages' : 'a bed with its passage',
    w: bedW + 2 * BED_SIDE_CLEARANCE,
    d: bedD + 600,
  };
  if (primariesOnly || !bedBox || !bedRun) return { primary };

  // bedsides flanking a double bed, against the same (headboard) wall
  if (double) {
    const along = bedRun.horizontal;
    const [b0, b1] = along ? [bedBox.x0, bedBox.x1] : [bedBox.y0, bedBox.y1];
    const perp0 = bedRun.inward > 0 ? bedRun.base : bedRun.base - 450;
    const perp1 = perp0 + 450;
    for (const s of [b0 - 450, b1]) {
      const box: Box = along
        ? { x0: s, x1: s + 450, y0: perp0, y1: perp1 }
        : { y0: s, y1: s + 450, x0: perp0, x1: perp1 };
      if (
        boxInsideRoom(ctx, box) &&
        !ctx.occupied.some((o) => overlaps(o, box)) &&
        !spanBlocked(bedRun.doorSpans, along ? box.x0 : box.y0, along ? box.x1 : box.y1)
      ) {
        commit(ctx, bedRun, 'bedside', box);
      }
    }
  }

  // B05: wardrobe run on the longest interior wall (tall — respects windows anyway)
  const interior = ctx.runs.filter((r) => !r.exterior && r.wall.id !== bedRun.wall.id);
  for (const run of interior) {
    const len = Math.min(Math.max(1200, runLength(run) - 200), 2400);
    const box = fitOnRun(ctx, run, len, 600, { prefer: 'center', tall: true });
    if (box) {
      commit(ctx, run, 'wardrobe', box);
      break;
    }
  }

  // F02: desk within 1 m of a window when the room is generous
  if (grossM2 >= 12) {
    const nearWindow = ctx.runs.filter((r) => r.windowSpans.length > 0);
    placeOnAny(ctx, nearWindow, 'desk', 1200, 600, { prefer: 'start' });
  }
  return { primary };
};

const planLiving = (ctx: RoomContext, primariesOnly: boolean): PlannerOut => {
  // sofa on the longest wall stretch (door-free by construction of fitOnRun)
  const sofaRun = ctx.runs;
  let sofa: FurnitureItem | null = placeOnAny(ctx, sofaRun, 'sofa', 2200, 900, { prefer: 'center' });
  if (!sofa) sofa = placeOnAny(ctx, sofaRun, 'sofa', 1800, 900, { prefer: 'center' });
  const primary = { placed: sofa !== null, label: 'a seating group', w: 2500, d: 2000 };
  if (primariesOnly || !sofa) return { primary };

  // coffee table 400 mm in front of the sofa (F01: ≥300 between seating)
  const gap = 400;
  const facing = sofa.facing;
  const ct: Box =
    facing === 'N'
      ? { x0: sofa.x + Math.round((sofa.w - 1100) / 2), x1: 0, y0: sofa.y + sofa.h + gap, y1: 0 }
      : facing === 'S'
        ? { x0: sofa.x + Math.round((sofa.w - 1100) / 2), x1: 0, y0: sofa.y - gap - 600, y1: 0 }
        : facing === 'E'
          ? { x0: sofa.x + sofa.w + gap, x1: 0, y0: sofa.y + Math.round((sofa.h - 1100) / 2), y1: 0 }
          : { x0: sofa.x - gap - 600, x1: 0, y0: sofa.y + Math.round((sofa.h - 1100) / 2), y1: 0 };
  ct.x1 = ct.x0 + (facing === 'N' || facing === 'S' ? 1100 : 600);
  ct.y1 = ct.y0 + (facing === 'N' || facing === 'S' ? 600 : 1100);
  if (boxInsideRoom(ctx, ct) && !ctx.occupied.some((o) => overlaps(o, ct))) {
    commit(ctx, ctx.runs[0] as Run, 'coffee-table', ct);
    const last = ctx.items[ctx.items.length - 1] as FurnitureItem;
    last.facing = facing; // table faces the sofa's way, not its host run's
  }

  // F06: dining zone as a second group in generous rooms
  if (ctx.room.grossArea / 1e6 >= 18) {
    placeOnAny(ctx, ctx.runs, 'dining-table', 1600, 900, { prefer: 'end', sideClearance: 600 });
  }
  return { primary };
};

const planKitchen = (ctx: RoomContext, primariesOnly: boolean): PlannerOut => {
  // F06: worktop along the exterior wall (sink under the window is classic —
  // window spans do NOT block it); L-turn onto the adjacent wall when short
  const exterior = ctx.runs.filter((r) => r.exterior);
  const pool = exterior.length > 0 ? exterior : ctx.runs;
  let placedRun: Run | null = null;
  let worktop: Box | null = null;
  for (const run of pool) {
    const len = Math.max(1200, Math.min(runLength(run) - 200, 3600));
    const box = fitOnRun(ctx, run, len, 600, { prefer: 'center' });
    if (box) {
      placedRun = run;
      worktop = box;
      commit(ctx, run, 'worktop', box);
      break;
    }
  }
  const primary = { placed: worktop !== null, label: 'a worktop run with clearance', w: 2400, d: 1800 };
  if (primariesOnly || !worktop || !placedRun) return { primary };

  const runLen = worktop
    ? placedRun.horizontal
      ? worktop.x1 - worktop.x0
      : worktop.y1 - worktop.y0
    : 0;
  if (runLen < 2400) {
    // L-turn: continue on a perpendicular wall
    const perpendicular = ctx.runs.filter((r) => r.horizontal !== placedRun?.horizontal);
    placeOnAny(ctx, perpendicular, 'worktop', Math.max(900, 2400 - runLen), 600, { prefer: 'start' });
  }
  // fridge at the run's end — tall, keeps clear of window spans
  placeOnAny(ctx, [placedRun, ...ctx.runs.filter((r) => r.wall.id !== placedRun?.wall.id)], 'appliance', 600, 600, {
    prefer: 'end',
    tall: true,
  });
  return { primary };
};

const planBathroom = (ctx: RoomContext, primariesOnly: boolean): PlannerOut => {
  // W05 fixture run: bath on the long wall, basin beside, toilet on another wall
  const bath: FurnitureItem | null = placeOnAny(ctx, ctx.runs, 'bath', 1500, 700, { prefer: 'start' });
  const primary = { placed: bath !== null, label: 'the bath + basin fixture run', w: 1650, d: 2300 };
  if (primariesOnly || !bath) return { primary };
  placeOnAny(ctx, ctx.runs, 'basin', 550, 420, { prefer: 'start' });
  placeOnAny(ctx, ctx.runs, 'toilet', 670, 400, { prefer: 'center', sideClearance: TOILET_SIDE_CLEARANCE });
  return { primary };
};

const planWc = (ctx: RoomContext, primariesOnly: boolean): PlannerOut => {
  // Do04 already swings the door outward; the toilet faces the door wall
  const byDistance = [...ctx.runs].sort(
    (a, b) =>
      distanceFromDoors(ctx, b) - distanceFromDoors(ctx, a) || (a.wall.id < b.wall.id ? -1 : 1),
  );
  const toilet = placeOnAny(ctx, byDistance, 'toilet', 670, 400, {
    prefer: 'center',
    sideClearance: TOILET_SIDE_CLEARANCE,
  });
  const primary = { placed: toilet !== null, label: 'a toilet with clearance', w: 900, d: 1400 };
  if (primariesOnly || !toilet) return { primary };
  const width = Math.min(ctx.bbox.x1 - ctx.bbox.x0, ctx.bbox.y1 - ctx.bbox.y0);
  if (width >= 1200) placeOnAny(ctx, ctx.runs, 'basin', 400, 300, { prefer: 'start' });
  return { primary };
};

const planHall = (ctx: RoomContext): PlannerOut => {
  // E05: built-in storage lines the entry — tall, hatched, no primary
  const run = ctx.runs.find((r) => runLength(r) >= 1000);
  if (run) {
    const len = Math.min(Math.max(800, runLength(run) - 400), 1800);
    const box = fitOnRun(ctx, run, len, 450, { prefer: 'center', tall: true });
    if (box) commit(ctx, run, 'shoe-cabinet', box);
  }
  return { primary: null };
};

const planStorage = (ctx: RoomContext): PlannerOut => {
  const run = ctx.runs[0];
  if (run) {
    const len = Math.max(600, runLength(run) - 200);
    const box = fitOnRun(ctx, run, len, 400, { prefer: 'center', tall: true });
    if (box) commit(ctx, run, 'shelf', box);
  }
  return { primary: null };
};

export function placeFurniture(
  rooms: PlanRoom[],
  walls: Wall[],
  doors: Door[],
  windows: Window[],
  specOf: Map<string, RoomSpec>,
  options: PlaceOptions = {},
): PlacementResult {
  const primariesOnly = options.primariesOnly ?? false;
  const items: FurnitureItem[] = [];
  const violations: Violation[] = [];
  let primaryCount = 0;
  let primaryPlaced = 0;

  for (const room of rooms) {
    const spec = specOf.get(room.specId);
    if (!spec) continue;
    if (spec.type === 'balcony' || spec.type === 'other') continue;
    const ctx = buildContext(room, spec, walls, doors, windows);
    if (!ctx) continue; // non-rectilinear: silent skip, never a violation

    let out: PlannerOut;
    switch (spec.type) {
      case 'bedroom':
        out = planBedroom(ctx, primariesOnly);
        break;
      case 'living':
        out = planLiving(ctx, primariesOnly);
        break;
      case 'kitchen':
        out = planKitchen(ctx, primariesOnly);
        break;
      case 'bathroom':
        out = planBathroom(ctx, primariesOnly);
        break;
      case 'wc':
        out = planWc(ctx, primariesOnly);
        break;
      case 'hall':
        out = primariesOnly ? { primary: null } : planHall(ctx);
        break;
      case 'storage':
        out = primariesOnly ? { primary: null } : planStorage(ctx);
        break;
      default:
        out = { primary: null };
    }
    items.push(...ctx.items);
    if (out.primary) {
      primaryCount += 1;
      if (out.primary.placed) primaryPlaced += 1;
      else {
        violations.push(
          violation(
            'FURNITURE_UNFIT',
            'warning',
            `"${spec.name}" cannot fit ${out.primary.label} — needs ${(out.primary.w / 1000).toFixed(1)} × ${(out.primary.d / 1000).toFixed(1)} m clear of door swings.`,
            [room.id],
          ),
        );
      }
    }
  }
  return { items, violations, primaryCount, primaryPlaced };
}

/**
 * Do07: mirror doors whose swing sweeps furniture to the other end of their
 * wall (t0' = 1 − t0 − width/len, hinge a↔b). One pass, doors in id order,
 * each judged once against furniture, OTHER doors' swings (Do03) — adopt the
 * mirror only when strictly fewer collisions. Callers must re-place
 * furniture afterwards when `changed`, then report residual overlaps via
 * swingObstructions — never loop.
 */
export function resolveSwingConflicts(
  doors: Door[],
  walls: Wall[],
  items: FurnitureItem[],
): { doors: Door[]; changed: boolean } {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const result = [...doors];
  let changed = false;

  const itemBoxes: Box[] = items.map((f) => ({ x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h }));
  const collisions = (door: Door, exceptId: string): number => {
    const wall = wallById.get(door.wallId);
    if (!wall) return 0;
    const swing = doorSwingBox(door, wall);
    if (!swing) return 0;
    let n = 0;
    for (const box of itemBoxes) if (overlaps(swing, box)) n += 1;
    for (const other of result) {
      if (other.id === exceptId || (other.kind ?? 'door') !== 'door') continue;
      const ow = wallById.get(other.wallId);
      if (!ow) continue;
      const os = doorSwingBox(other, ow);
      if (os && overlaps(swing, os)) n += 1;
    }
    return n;
  };

  for (let i = 0; i < result.length; i++) {
    const door = result[i] as Door;
    if ((door.kind ?? 'door') !== 'door' || door.connects[1] === 'outside') continue;
    const wall = wallById.get(door.wallId);
    if (!wall) continue;
    const before = collisions(door, door.id);
    if (before === 0) continue;
    const len = wall.a.x === wall.b.x ? Math.abs(wall.b.y - wall.a.y) : Math.abs(wall.b.x - wall.a.x);
    if (len === 0) continue;
    const mirrored: Door = {
      ...door,
      t0: 1 - door.t0 - door.width / len,
      hinge: (door.hinge ?? 'a') === 'a' ? 'b' : 'a',
    };
    result[i] = mirrored;
    const after = collisions(mirrored, door.id);
    if (after < before) {
      changed = true;
    } else {
      result[i] = door; // tie or worse keeps the original
    }
  }
  return { doors: result, changed };
}

/** Residual swing-over-furniture overlaps, reported as info (Do07 flag). */
export function swingObstructions(
  doors: Door[],
  walls: Wall[],
  items: FurnitureItem[],
  nameOfRoom: (roomId: string) => string,
): Violation[] {
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const out: Violation[] = [];
  for (const door of doors) {
    if ((door.kind ?? 'door') !== 'door') continue;
    const wall = wallById.get(door.wallId);
    if (!wall) continue;
    const swing = doorSwingBox(door, wall);
    if (!swing) continue;
    const hit = items.find((f) => overlaps(swing, { x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h }));
    if (hit) {
      out.push(
        violation(
          'DOOR_SWING_OBSTRUCTED',
          'info',
          `A door swing in "${nameOfRoom(hit.roomId)}" sweeps over furniture — consider sliding the door or the leaf.`,
          [door.id, hit.roomId],
        ),
      );
    }
  }
  return out;
}
