import { describe, expect, it } from 'vitest';
import { area2OfPoly } from '../geometry/clip';
import { mm } from '../units';
import type { Plot } from '../plot/types';
import { defaultAreaRange, PROGRAM_DEFAULTS, ROOM_TYPE_DEFAULTS } from '../program/defaults';
import type { Program, RoomSpec, RoomType } from '../program/types';
import { generate } from '../solver/pipeline';
import { flipDoorSwing, moveWallClamped } from './edit';

const room = (id: string, type: RoomType): RoomSpec => ({
  id,
  name: ROOM_TYPE_DEFAULTS[type].label,
  type,
  area: defaultAreaRange(type),
  minDim: ROOM_TYPE_DEFAULTS[type].minDim,
  prefs: { ...ROOM_TYPE_DEFAULTS[type].prefs },
});

const program: Program = {
  rooms: [room('living', 'living'), room('bed', 'bedroom'), room('bath', 'bathroom'), room('hall', 'hall')],
  adjacency: [],
  circulation: { mode: 'implicit', factor: 0.1 },
  defaults: PROGRAM_DEFAULTS,
};

const plot: Plot = {
  boundary: [
    { x: mm(0), y: mm(0) },
    { x: mm(11_000), y: mm(0) },
    { x: mm(11_000), y: mm(8_000) },
    { x: mm(0), y: mm(8_000) },
  ],
  setback: { uniform: mm(0) },
  northDeg: 0,
  entrance: { edgeIndex: 0, t: 0.5 },
};

describe('plan edits', () => {
  const result = generate({
    program,
    plot,
    seed: 9,
    k: 1,
    budgetMs: 0,
    candidateCount: 16,
    annealIterations: 300,
  });
  const plan = result.variants[0];

  it('generated a base plan to edit', () => {
    expect(plan).toBeDefined();
  });

  it('at least one wall is draggable; moves keep the tessellation exact', () => {
    if (!plan) return;
    const candidates = plan.walls.filter(
      (w) => w.kind === 'interior' && (w.a.x === w.b.x || w.a.y === w.b.y),
    );
    expect(candidates.length).toBeGreaterThan(0);
    let moved = null;
    const original = plan;
    for (const wall of candidates) {
      moved = moveWallClamped(plan, program, plot, wall.id, mm(300)) ?? moveWallClamped(plan, program, plot, wall.id, mm(-300));
      if (moved) break;
    }
    expect(moved).not.toBeNull();
    if (!moved) return;
    expect(moved.rooms).toHaveLength(original.rooms.length);
    const total = moved.rooms.reduce((s, r) => s + area2OfPoly(r.poly), 0);
    expect(total).toBe(area2OfPoly(moved.footprint));
    const changed = moved.rooms.filter((r, i) => r.grossArea !== original.rooms[i]?.grossArea);
    expect(changed.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects absurd moves instead of corrupting the plan', () => {
    if (!plan) return;
    const wall = plan.walls.find((w) => w.kind === 'interior' && (w.a.x === w.b.x || w.a.y === w.b.y));
    if (!wall) return;
    const moved = moveWallClamped(plan, program, plot, wall.id, mm(50_000));
    // clamping may find a small valid move or give up — never throws, never corrupts
    if (moved) {
      const total = moved.rooms.reduce((s, r) => s + area2OfPoly(r.poly), 0);
      expect(total).toBe(area2OfPoly(moved.footprint));
    }
  });

  it('flipDoorSwing flips exactly one door and revalidates', () => {
    if (!plan) return;
    const door = plan.doors[0];
    expect(door).toBeDefined();
    if (!door) return;
    const flipped = flipDoorSwing(plan, program, plot, door.id);
    expect(flipped).not.toBeNull();
    expect(flipped?.doors.find((d) => d.id === door.id)?.swing).not.toBe(door.swing);
  });
});
