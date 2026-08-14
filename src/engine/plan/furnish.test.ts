// Furnishability v1: template fits by bbox + door-swing exclusion.

import { describe, expect, it } from 'vitest';
import { poly, type Ring } from '../geometry/polygon';
import { mm, mm2 } from '../units';
import { defaultAreaRange } from '../program/defaults';
import type { RoomSpec, RoomType } from '../program/types';
import { checkFurnishability } from './furnish';
import type { Door, PlanRoom, Wall } from './types';

const rectRoom = (id: string, w: number, h: number): PlanRoom => {
  const ring: Ring = [
    { x: mm(0), y: mm(0) },
    { x: mm(w), y: mm(0) },
    { x: mm(w), y: mm(h) },
    { x: mm(0), y: mm(h) },
  ];
  return { id, specId: `${id}-spec`, poly: poly(ring), grossArea: mm2(w * h), netArea: mm2(w * h) };
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

describe('checkFurnishability', () => {
  it('passes a 4×4 m bedroom (double bed template)', () => {
    const room = rectRoom('bed', 4000, 4000);
    const out = checkFurnishability([room], [], [], specMap(spec('bed', 'bedroom')));
    expect(out).toHaveLength(0);
  });

  it('flags a bedroom too small for even a single bed with passage', () => {
    const room = rectRoom('bed', 2200, 2500); // needs 1400×2600 in some orientation
    const out = checkFurnishability([room], [], [], specMap(spec('bed', 'bedroom')));
    expect(out).toHaveLength(1);
    expect(out[0]?.code).toBe('FURNITURE_UNFIT');
  });

  it('flags a WC below the W04 fixture + clearance envelope', () => {
    const bad = rectRoom('wc', 850, 1200);
    const good = rectRoom('wc2', 900, 1500);
    const violations = checkFurnishability(
      [bad, good],
      [],
      [],
      specMap(spec('wc', 'wc'), spec('wc2', 'wc')),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.subjects).toContain('wc');
  });

  it('door swings exclude furniture: a door mid-wall can break a tight fit', () => {
    // 2600×2700 bedroom: single template 1400×2600 fits ONLY along the
    // 2700 walls; a 900 door centred on one long wall still leaves room by
    // sliding, but doors on BOTH long walls pin it.
    const room = rectRoom('bed', 2600, 2700);
    const wallW: Wall = {
      id: 'w-west',
      a: { x: mm(0), y: mm(0) },
      b: { x: mm(0), y: mm(2700) },
      thickness: mm(100),
      kind: 'interior',
      leftRoomId: 'bed',
      rightRoomId: 'x',
    };
    const wallE: Wall = {
      id: 'w-east',
      a: { x: mm(2600), y: mm(0) },
      b: { x: mm(2600), y: mm(2700) },
      thickness: mm(100),
      kind: 'interior',
      leftRoomId: 'x',
      rightRoomId: 'bed',
    };
    const door = (id: string, wallId: string): Door => ({
      id,
      wallId,
      t0: 0.33,
      width: mm(900),
      swing: 'left',
      connects: ['bed', 'x'],
    });
    const clear = checkFurnishability([room], [wallW], [door('d1', 'w-west')], specMap(spec('bed', 'bedroom')));
    expect(clear).toHaveLength(0);
    const pinned = checkFurnishability(
      [room],
      [wallW, wallE],
      [door('d1', 'w-west'), door('d2', 'w-east')],
      specMap(spec('bed', 'bedroom')),
    );
    expect(pinned).toHaveLength(1);
  });

  it('skips non-rectangular rooms and types without templates', () => {
    const lShape: Ring = [
      { x: mm(0), y: mm(0) },
      { x: mm(4000), y: mm(0) },
      { x: mm(4000), y: mm(2000) },
      { x: mm(2000), y: mm(2000) },
      { x: mm(2000), y: mm(4000) },
      { x: mm(0), y: mm(4000) },
    ];
    const weird: PlanRoom = {
      id: 'L',
      specId: 'L-spec',
      poly: poly(lShape),
      grossArea: mm2(12_000_000),
      netArea: mm2(12_000_000),
    };
    const hall = rectRoom('hall', 1200, 5000);
    const out = checkFurnishability(
      [weird, hall],
      [],
      [],
      specMap(spec('L', 'bedroom'), spec('hall', 'hall')),
    );
    expect(out).toHaveLength(0);
  });
});
