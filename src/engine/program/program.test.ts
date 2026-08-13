import { describe, expect, it } from 'vitest';
import { mm, mm2FromM2 } from '../units';
import { defaultAreaRange, PROGRAM_DEFAULTS } from './defaults';
import { normalizeProgram } from './normalize';
import type { Program, RoomSpec } from './types';
import { validateProgram } from './validate';

const room = (id: string, over: Partial<RoomSpec> = {}): RoomSpec => ({
  id,
  name: `Room ${id}`,
  type: 'bedroom',
  area: defaultAreaRange('bedroom'),
  minDim: mm(2700),
  prefs: {},
  ...over,
});

const program = (rooms: RoomSpec[], adjacency: Program['adjacency'] = []): Program => ({
  rooms,
  adjacency,
  circulation: { mode: 'implicit', factor: 0.12 },
  defaults: PROGRAM_DEFAULTS,
});

describe('validateProgram', () => {
  it('flags empty programs', () => {
    const out = validateProgram(program([]));
    expect(out.some((v) => v.code === 'PROGRAM_EMPTY' && v.severity === 'error')).toBe(true);
  });

  it('flags inverted area ranges', () => {
    const bad = room('a', { area: { min: mm2FromM2(20), ideal: mm2FromM2(10), max: mm2FromM2(15) } });
    const out = validateProgram(program([bad]));
    expect(out.some((v) => v.code === 'ROOM_AREA_RANGE_INVALID')).toBe(true);
  });

  it('flags minDim incompatible with max area, with an applicable fix', () => {
    const bad = room('a', { minDim: mm(5000), area: { min: mm2FromM2(9), ideal: mm2FromM2(12), max: mm2FromM2(16) } });
    const out = validateProgram(program([bad]));
    const hit = out.find((v) => v.code === 'ROOM_MINDIM_INCONSISTENT');
    expect(hit).toBeDefined();
    expect(hit?.fix?.relaxation.kind).toBe('roomMinDim');
  });

  it('flags required+avoid conflicts on the same pair', () => {
    const out = validateProgram(
      program(
        [room('a'), room('b')],
        [
          { a: 'a', b: 'b', kind: 'required', weight: 2 },
          { a: 'b', b: 'a', kind: 'avoid', weight: 1 },
        ],
      ),
    );
    expect(out.some((v) => v.code === 'ADJACENCY_CONFLICT' && v.severity === 'error')).toBe(true);
  });

  it('warns on Euler-bound violation (non-planar wish graph)', () => {
    // K5 between 5 rooms: 10 edges > 3·5−6 = 9
    const rooms = ['a', 'b', 'c', 'd', 'e'].map((id) => room(id));
    const adjacency: Program['adjacency'] = [];
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        adjacency.push({ a: rooms[i]?.id ?? '', b: rooms[j]?.id ?? '', kind: 'preferred', weight: 1 });
      }
    }
    const out = validateProgram(program(rooms, adjacency));
    expect(out.some((v) => v.code === 'ADJACENCY_NONPLANAR_HINT')).toBe(true);
  });
});

describe('normalizeProgram', () => {
  it('dedupes names and drops dangling/self/duplicate adjacency', () => {
    const p = program(
      [room('a', { name: 'Bedroom' }), room('b', { name: 'Bedroom' })],
      [
        { a: 'a', b: 'ghost', kind: 'required', weight: 3 },
        { a: 'a', b: 'a', kind: 'required', weight: 3 },
        { a: 'a', b: 'b', kind: 'preferred', weight: 1 },
        { a: 'b', b: 'a', kind: 'required', weight: 2 },
      ],
    );
    const n = normalizeProgram(p);
    expect(n.rooms.map((r) => r.name)).toEqual(['Bedroom', 'Bedroom 2']);
    expect(n.adjacency).toHaveLength(1);
    expect(n.adjacency[0]?.kind).toBe('required');
  });

  it('clamps ideal into [min,max] and circulation into range', () => {
    const p = program([
      room('a', { area: { min: mm2FromM2(10), ideal: mm2FromM2(50), max: mm2FromM2(20) } }),
    ]);
    p.circulation.factor = 0.9;
    const n = normalizeProgram(p);
    expect(n.rooms[0]?.area.ideal).toBe(mm2FromM2(20));
    expect(n.circulation.factor).toBe(0.35);
  });
});
