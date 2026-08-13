import { describe, expect, it } from 'vitest';
import { area2OfPoly, intersectPolys } from '../geometry/clip';
import { mm } from '../units';
import type { Plot } from '../plot/types';
import { defaultAreaRange, PROGRAM_DEFAULTS, ROOM_TYPE_DEFAULTS } from '../program/defaults';
import type { Program, RoomSpec, RoomType } from '../program/types';
import { generate, type GenerateRequest } from './pipeline';

const room = (id: string, type: RoomType, over: Partial<RoomSpec> = {}): RoomSpec => ({
  id,
  name: ROOM_TYPE_DEFAULTS[type].label,
  type,
  area: defaultAreaRange(type),
  minDim: ROOM_TYPE_DEFAULTS[type].minDim,
  prefs: { ...ROOM_TYPE_DEFAULTS[type].prefs },
  ...over,
});

const twoBedProgram = (): Program => ({
  rooms: [
    room('living', 'living'),
    room('kitchen', 'kitchen'),
    room('bed1', 'bedroom'),
    room('bed2', 'bedroom'),
    room('bath', 'bathroom'),
    room('hall', 'hall'),
  ],
  adjacency: [
    { a: 'hall', b: 'living', kind: 'required', weight: 3 },
    { a: 'living', b: 'kitchen', kind: 'preferred', weight: 2 },
    { a: 'hall', b: 'bath', kind: 'preferred', weight: 2 },
  ],
  circulation: { mode: 'implicit', factor: 0.1 },
  defaults: PROGRAM_DEFAULTS,
});

const rectPlot = (w: number, d: number): Plot => ({
  boundary: [
    { x: mm(0), y: mm(0) },
    { x: mm(w), y: mm(0) },
    { x: mm(w), y: mm(d) },
    { x: mm(0), y: mm(d) },
  ],
  setback: { uniform: mm(0) },
  northDeg: 0,
  entrance: { edgeIndex: 0, t: 0.5 },
});

const request = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  program: twoBedProgram(),
  plot: rectPlot(12_000, 8_000),
  seed: 42,
  k: 4,
  budgetMs: 0,
  candidateCount: 24,
  annealIterations: 400,
  ...over,
});

describe('generate pipeline', () => {
  it('produces variants whose rooms tile the footprint exactly (rectilinear identity)', () => {
    const result = generate(request());
    expect(result.feasibility).toBe('ok');
    expect(result.variants.length).toBeGreaterThan(0);
    for (const variant of result.variants) {
      const total = variant.rooms.reduce((s, r) => s + area2OfPoly(r.poly), 0);
      expect(total).toBe(area2OfPoly(variant.footprint));
      for (let i = 0; i < variant.rooms.length; i++) {
        for (let j = i + 1; j < variant.rooms.length; j++) {
          const inter = intersectPolys(
            variant.rooms[i]!.poly,
            variant.rooms[j]!.poly,
          ).reduce((s, p) => s + area2OfPoly(p), 0);
          expect(inter).toBe(0);
        }
      }
    }
  });

  it('is deterministic: same seed → deep-equal results', () => {
    const a = generate(request());
    const b = generate(request());
    expect(a).toEqual(b);
  });

  it('different seeds usually differ', () => {
    const a = generate(request({ seed: 1 }));
    const b = generate(request({ seed: 2 }));
    expect(JSON.stringify(a.variants[0]?.rooms.map((r) => r.poly))).not.toBe(
      JSON.stringify(b.variants[0]?.rooms.map((r) => r.poly)),
    );
  });

  it('single room becomes the whole footprint', () => {
    const result = generate(request({ program: { ...twoBedProgram(), rooms: [room('solo', 'living')] } }));
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]?.rooms[0] && area2OfPoly(result.variants[0].rooms[0].poly)).toBe(
      2 * 12_000 * 8_000,
    );
  });

  it('blocks invalid input with violations instead of throwing', () => {
    const bad = request({ plot: { ...rectPlot(12_000, 8_000), boundary: [] } });
    const result = generate(bad);
    expect(result.feasibility).toBe('blocked');
    expect(result.variants).toHaveLength(0);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('reports infeasible programs with ranked fixes', () => {
    const result = generate(request({ plot: rectPlot(6_000, 5_000) }));
    expect(result.feasibility).toBe('infeasible');
    const withFix = result.violations.find((v) => v.code === 'AREA_INFEASIBLE' && v.fix);
    expect(withFix).toBeDefined();
  });

  it('honors cancellation and still returns a structured result', () => {
    let calls = 0;
    const result = generate(request(), { shouldCancel: () => ++calls > 3 });
    expect(result.cancelled).toBe(true);
    expect(Array.isArray(result.variants)).toBe(true);
  });

  it('gives every variant an entrance, full door reachability, and openings that fit', () => {
    for (const seed of [3, 11, 77]) {
      const result = generate(request({ seed }));
      expect(result.variants.length).toBeGreaterThan(0);
      for (const variant of result.variants) {
        // entrance exists
        expect(variant.doors.some((d) => d.connects.includes('outside'))).toBe(true);
        // no unreachable-room errors
        expect(variant.violations.filter((v) => v.code === 'ROOM_UNREACHABLE')).toHaveLength(0);
        // openings sit on their walls
        const wallById = new Map(variant.walls.map((w) => [w.id, w]));
        for (const opening of [...variant.doors, ...variant.windows]) {
          const wall = wallById.get(opening.wallId);
          expect(wall).toBeDefined();
          const len = wall ? Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) : 0;
          expect(opening.t0).toBeGreaterThanOrEqual(0);
          expect(opening.t0 * len + opening.width).toBeLessThanOrEqual(len + 1);
        }
        // walls have stable unique ids and positive length
        const ids = new Set(variant.walls.map((w) => w.id));
        expect(ids.size).toBe(variant.walls.length);
        for (const wall of variant.walls) {
          expect(Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y)).toBeGreaterThan(0);
        }
        // net areas are positive and below gross
        for (const room of variant.rooms) {
          expect(room.netArea).toBeGreaterThan(0);
          expect(room.netArea).toBeLessThanOrEqual(room.grossArea);
        }
      }
    }
  });

  it('door tree routes through halls/living, not through private rooms', () => {
    const PRIVATE = new Set(['bedroom', 'bathroom', 'wc', 'storage', 'balcony']);
    for (const seed of [3, 11, 77]) {
      const result = generate(request({ seed }));
      for (const variant of result.variants) {
        const typeOfRoom = (roomId: string): string => {
          const planRoom = variant.rooms.find((r) => r.id === roomId);
          const spec = twoBedProgram().rooms.find((s) => s.id === planRoom?.specId);
          return spec?.type ?? 'other';
        };
        const flagged = new Set(
          variant.violations.filter((v) => v.code === 'PRIVATE_TRANSIT').flatMap((v) => v.subjects),
        );
        for (const door of variant.doors) {
          const [a, b] = door.connects;
          if (b === 'outside' || a === 'outside') continue;
          // a door between two PRIVATE rooms is only allowed when geometry
          // forced it and the violation says so
          if (PRIVATE.has(typeOfRoom(a)) && PRIVATE.has(typeOfRoom(b))) {
            expect(flagged.has(a) || flagged.has(b)).toBe(true);
          }
        }
      }
    }
  });

  it('interior walls know both flanking rooms; exterior walls border outside', () => {
    const result = generate(request({ seed: 5 }));
    const variant = result.variants[0];
    expect(variant).toBeDefined();
    if (!variant) return;
    for (const wall of variant.walls) {
      if (wall.kind === 'interior') {
        expect(wall.leftRoomId).not.toBeNull();
        expect(wall.rightRoomId).not.toBeNull();
      } else {
        expect(wall.leftRoomId === null || wall.rightRoomId === null).toBe(true);
      }
    }
  });

  it('works on a concave (L-shaped) plot', () => {
    const plot: Plot = {
      boundary: [
        { x: mm(0), y: mm(0) },
        { x: mm(14_000), y: mm(0) },
        { x: mm(14_000), y: mm(6_000) },
        { x: mm(8_000), y: mm(6_000) },
        { x: mm(8_000), y: mm(11_000) },
        { x: mm(0), y: mm(11_000) },
      ],
      setback: { uniform: mm(0) },
      northDeg: 0,
    };
    const result = generate(request({ plot, seed: 7 }));
    expect(result.variants.length).toBeGreaterThan(0);
    for (const variant of result.variants) {
      const total = variant.rooms.reduce((s, r) => s + area2OfPoly(r.poly), 0);
      expect(total).toBe(area2OfPoly(variant.footprint));
    }
  });
});
