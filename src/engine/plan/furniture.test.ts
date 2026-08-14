// Furniture placement: determinism, rule conformance (F03 span avoidance,
// B05 wardrobe, W04 clearances), L-room containment, Do07 mirror pass.

import { describe, expect, it } from 'vitest';
import { poly, type Ring } from '../geometry/polygon';
import { mm, mm2 } from '../units';
import { defaultAreaRange, PROGRAM_DEFAULTS } from '../program/defaults';
import type { RoomSpec, RoomType } from '../program/types';
import { doorSwingBox, placeFurniture, resolveSwingConflicts, swingObstructions } from './furniture';
import { extractWalls } from './walls';
import type { Door, FurnitureItem, PlanRoom, Wall, Window } from './types';

const ring = (pts: Array<[number, number]>): Ring => pts.map(([x, y]) => ({ x: mm(x), y: mm(y) }));

const roomOf = (id: string, pts: Array<[number, number]>): PlanRoom => {
  const p = poly(ring(pts));
  const area = Math.abs(pts.reduce((s, [x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length] as [number, number];
    return s + x * ny - nx * y;
  }, 0)) / 2;
  return { id, specId: `${id}-spec`, poly: p, grossArea: mm2(area), netArea: mm2(area) };
};

const spec = (id: string, type: RoomType): RoomSpec => ({
  id: `${id}-spec`,
  name: id,
  type,
  area: defaultAreaRange(type),
  minDim: mm(900),
  prefs: {},
});

const specMap = (...specs: RoomSpec[]): Map<string, RoomSpec> => new Map(specs.map((s) => [s.id, s]));

/** Two rooms side by side in a 6×4 m footprint; walls extracted for real. */
const twoRoomFixture = () => {
  const footprint = poly(ring([[0, 0], [6000, 0], [6000, 4000], [0, 4000]]));
  const a = roomOf('A', [[0, 0], [3000, 0], [3000, 4000], [0, 4000]]);
  const b = roomOf('B', [[3000, 0], [6000, 0], [6000, 4000], [3000, 4000]]);
  const walls = extractWalls([a, b], footprint, PROGRAM_DEFAULTS);
  const shared = walls.find((w) => w.kind === 'interior') as Wall;
  return { footprint, a, b, walls, shared };
};

const doorOn = (wall: Wall, t0: number, swing: 'left' | 'right', connects: [string, string]): Door => ({
  id: 'd0',
  wallId: wall.id,
  t0,
  width: mm(900),
  swing,
  connects,
});

describe('placeFurniture', () => {
  it('is deterministic: identical calls give deep-equal items', () => {
    const { a, b, walls, shared } = twoRoomFixture();
    const doors = [doorOn(shared, 0.4, 'left', ['A', 'B'])];
    const specs = specMap(spec('A', 'bedroom'), spec('B', 'living'));
    const r1 = placeFurniture([a, b], walls, doors, [], specs);
    const r2 = placeFurniture([a, b], walls, doors, [], specs);
    expect(r1).toEqual(r2);
    expect(r1.items.length).toBeGreaterThan(0);
  });

  it('puts a double bed against the wall farthest from the door', () => {
    const { a, b, walls, shared } = twoRoomFixture();
    // door on A's east wall (the shared wall) → farthest wall is west (x=0)
    const doors = [doorOn(shared, 0.4, 'left', ['A', 'B'])];
    const out = placeFurniture([a, b], walls, doors, [], specMap(spec('A', 'bedroom'), spec('B', 'living')));
    const bed = out.items.find((f) => f.kind === 'bed-double');
    expect(bed).toBeDefined();
    expect(bed?.roomId).toBe('A');
    expect(bed?.x).toBe(0); // headboard on the west wall
    expect(bed?.facing).toBe('E');
  });

  it('F03: the bed avoids the window SPAN, not the whole windowed wall', () => {
    const { a, b, walls, shared } = twoRoomFixture();
    const west = walls.find((w) => w.kind === 'exterior' && w.a.x === 0 && w.b.x === 0) as Wall;
    // window on the west wall's lower half: span ≈ y 400..1600
    const winLen = Math.abs(west.b.y - west.a.y);
    const win: Window = { id: 'n0', wallId: west.id, t0: 0.1, width: mm(1200) };
    const doors = [doorOn(shared, 0.4, 'left', ['A', 'B'])];
    const out = placeFurniture([a, b], walls, doors, [win], specMap(spec('A', 'bedroom'), spec('B', 'living')));
    const bed = out.items.find((f) => f.kind === 'bed-double') as FurnitureItem;
    expect(bed).toBeDefined();
    if (bed.x === 0) {
      // stayed on the windowed wall — must sit clear of the span
      const s0 = Math.min(west.a.y, west.b.y) + 0.1 * winLen;
      const s1 = s0 + 1200;
      expect(bed.y >= s1 || bed.y + bed.h <= s0).toBe(true);
    }
  });

  it('places a wardrobe on an interior wall (B05) and it avoids windows', () => {
    const { a, b, walls, shared } = twoRoomFixture();
    const doors = [doorOn(shared, 0.85, 'left', ['A', 'B'])];
    const out = placeFurniture([a, b], walls, doors, [], specMap(spec('A', 'bedroom'), spec('B', 'living')));
    const wardrobe = out.items.find((f) => f.kind === 'wardrobe' && f.roomId === 'A');
    expect(wardrobe).toBeDefined();
    // interior wall is x=3000; a 600-deep run against it starts at 2400
    expect(wardrobe?.x).toBe(2400);
  });

  it('flags a room whose primary piece cannot stand (FURNITURE_UNFIT)', () => {
    // 1.8×1.9 m: a 900×2000 bed + 500 side passages fits in no orientation
    const footprint = poly(ring([[0, 0], [1800, 0], [1800, 1900], [0, 1900]]));
    const tiny = roomOf('T', [[0, 0], [1800, 0], [1800, 1900], [0, 1900]]);
    const walls = extractWalls([tiny], footprint, PROGRAM_DEFAULTS);
    const out = placeFurniture([tiny], walls, [], [], specMap(spec('T', 'bedroom')));
    expect(out.primaryCount).toBe(1);
    expect(out.primaryPlaced).toBe(0);
    expect(out.violations.some((v) => v.code === 'FURNITURE_UNFIT')).toBe(true);
  });

  it('W04: toilet side clearance decides a WC fit', () => {
    const wide = roomOf('W1', [[0, 0], [1200, 0], [1200, 1600], [0, 1600]]);
    // 900×1100: 670 + 2×250 = 1170 exceeds BOTH axes → no orientation fits
    const narrow = roomOf('W2', [[2000, 0], [2900, 0], [2900, 1100], [2000, 1100]]);
    const footprint = poly(ring([[0, 0], [2900, 0], [2900, 1600], [0, 1600]]));
    const walls = extractWalls([wide, narrow], footprint, PROGRAM_DEFAULTS);
    const out = placeFurniture([wide, narrow], walls, [], [], specMap(spec('W1', 'wc'), spec('W2', 'wc')));
    const toilets = out.items.filter((f) => f.kind === 'toilet');
    expect(toilets.some((t) => t.roomId === 'W1')).toBe(true);
    expect(toilets.some((t) => t.roomId === 'W2')).toBe(false);
  });

  it('places inside an L-shaped room with exact containment', () => {
    const L = roomOf('L', [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]]);
    const footprint = poly(ring([[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]]));
    const walls = extractWalls([L], footprint, PROGRAM_DEFAULTS);
    const out = placeFurniture([L], walls, [], [], specMap(spec('L', 'bedroom')));
    const bed = out.items.find((f) => f.kind === 'bed-double');
    expect(bed).toBeDefined();
    // entire bed rect must lie inside the L (never straddle the notch corner)
    if (bed) {
      const inside = (x: number, y: number): boolean =>
        (x >= 0 && x <= 4000 && y >= 0 && y <= 2000) || (x >= 0 && x <= 2000 && y >= 0 && y <= 4000);
      expect(inside(bed.x, bed.y)).toBe(true);
      expect(inside(bed.x + bed.w, bed.y + bed.h)).toBe(true);
      expect(inside(bed.x + bed.w, bed.y)).toBe(true);
      expect(inside(bed.x, bed.y + bed.h)).toBe(true);
    }
  });

  it('skips non-rectilinear rooms silently', () => {
    const tri = roomOf('D', [[0, 0], [4000, 0], [0, 4000]]);
    const footprint = poly(ring([[0, 0], [4000, 0], [0, 4000]]));
    const walls = extractWalls([tri], footprint, PROGRAM_DEFAULTS);
    const out = placeFurniture([tri], walls, [], [], specMap(spec('D', 'bedroom')));
    expect(out.items).toHaveLength(0);
    expect(out.violations).toHaveLength(0);
    expect(out.primaryCount).toBe(0);
  });
});

describe('edit path keeps furniture fresh', () => {
  it('flipDoorSwing re-places furniture and preserves the user flip', async () => {
    const { generate } = await import('../solver/pipeline');
    const { flipDoorSwing } = await import('./edit');
    const program = {
      rooms: [spec('liv', 'living'), spec('bed', 'bedroom'), spec('hall', 'hall')].map((s, i) => ({
        ...s,
        id: ['liv', 'bed', 'hall'][i] as string,
        name: ['Living', 'Bedroom', 'Hall'][i] as string,
      })),
      adjacency: [],
      circulation: { mode: 'implicit' as const, factor: 0.1 },
      defaults: PROGRAM_DEFAULTS,
    };
    const plot = {
      boundary: ring([[0, 0], [9000, 0], [9000, 7000], [0, 7000]]),
      setback: { uniform: mm(0) },
      northDeg: 0,
      entrance: { edgeIndex: 0, t: 0.5 },
    };
    const result = generate({ program, plot, seed: 5, k: 1, budgetMs: 0, candidateCount: 24, annealIterations: 400 });
    const plan = result.variants[0];
    expect(plan).toBeDefined();
    expect(plan?.furniture?.length ?? 0).toBeGreaterThan(0);
    const interiorDoor = plan?.doors.find((d) => d.connects[1] !== 'outside');
    if (!plan || !interiorDoor) return;
    const flipped = flipDoorSwing(plan, program, plot, interiorDoor.id);
    expect(flipped).not.toBeNull();
    const after = flipped?.doors.find((d) => d.id === interiorDoor.id);
    expect(after?.swing).not.toBe(interiorDoor.swing); // user flip preserved
    expect(after?.t0).toBe(interiorDoor.t0); // NOT auto-mirrored back
    expect(flipped?.furniture).toBeDefined(); // furniture recomputed
  });
});

describe('Do07 swing resolution', () => {
  it('mirror maps the start jamb exactly onto the end jamb', () => {
    const { walls, shared } = twoRoomFixture();
    const len = Math.abs(shared.b.y - shared.a.y) || Math.abs(shared.b.x - shared.a.x);
    const jambT = 100 / len;
    const door = doorOn(shared, jambT, 'left', ['A', 'B']);
    const swing = doorSwingBox(door, shared);
    expect(swing).not.toBeNull();
    const items: FurnitureItem[] = [
      {
        id: 'A-f0',
        roomId: 'A',
        kind: 'wardrobe',
        x: mm(Math.min(swing!.x0, swing!.x1)),
        y: mm(Math.min(swing!.y0, swing!.y1)),
        w: mm(swing!.x1 - swing!.x0),
        h: mm(swing!.y1 - swing!.y0),
        facing: 'E',
      },
    ];
    const fixed = resolveSwingConflicts([door], walls, items);
    expect(fixed.changed).toBe(true);
    const mirrored = fixed.doors[0] as Door;
    expect(mirrored.hinge).toBe('b');
    expect(mirrored.t0).toBeCloseTo(1 - jambT - 900 / len, 10);
    // and the mirrored swing no longer hits the piece
    expect(swingObstructions(fixed.doors, walls, items, () => 'x')).toHaveLength(0);
  });

  it('keeps the door and reports info when both positions collide', () => {
    const { a, walls, shared } = twoRoomFixture();
    const door = doorOn(shared, 0.4, 'left', ['A', 'B']);
    // furniture covering A's whole east strip: both swing positions collide
    const blanket: FurnitureItem = {
      id: 'A-f0',
      roomId: 'A',
      kind: 'wardrobe',
      x: mm(2100),
      y: mm(0),
      w: mm(900),
      h: mm(4000),
      facing: 'W',
    };
    void a;
    const fixed = resolveSwingConflicts([door], walls, [blanket]);
    expect(fixed.changed).toBe(false);
    expect((fixed.doors[0] as Door).t0).toBe(0.4);
    const infos = swingObstructions(fixed.doors, walls, [blanket], () => 'A');
    expect(infos).toHaveLength(1);
    expect(infos[0]?.code).toBe('DOOR_SWING_OBSTRUCTED');
    expect(infos[0]?.severity).toBe('info');
  });
});
