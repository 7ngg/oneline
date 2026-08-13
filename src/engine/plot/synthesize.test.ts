import { describe, expect, it } from 'vitest';
import { defaultAreaRange, PROGRAM_DEFAULTS, ROOM_TYPE_DEFAULTS } from '../program/defaults';
import type { Program, RoomSpec, RoomType } from '../program/types';
import { generate } from '../solver/pipeline';
import { validatePlot } from './validate';
import { synthesizePlot } from './synthesize';

const room = (id: string, type: RoomType): RoomSpec => ({
  id,
  name: ROOM_TYPE_DEFAULTS[type].label,
  type,
  area: defaultAreaRange(type),
  minDim: ROOM_TYPE_DEFAULTS[type].minDim,
  prefs: { ...ROOM_TYPE_DEFAULTS[type].prefs },
});

const program = (types: RoomType[]): Program => ({
  rooms: types.map((t, i) => room(`r${i}`, t)),
  adjacency: [],
  circulation: { mode: 'implicit', factor: 0.12 },
  defaults: PROGRAM_DEFAULTS,
});

describe('synthesizePlot', () => {
  it('produces a valid plot that the full pipeline can solve, for varied programs', () => {
    const cases: RoomType[][] = [
      ['living'],
      ['living', 'bathroom', 'hall'],
      ['living', 'kitchen', 'bedroom', 'bedroom', 'bathroom', 'hall'],
      ['living', 'kitchen', 'bedroom', 'bedroom', 'bedroom', 'bathroom', 'wc', 'hall', 'storage'],
    ];
    for (const types of cases) {
      const p = program(types);
      const plot = synthesizePlot(p, 7);
      expect(validatePlot(plot)).toEqual([]);
      const result = generate({
        program: p,
        plot,
        seed: 7,
        k: 2,
        budgetMs: 0,
        candidateCount: 16,
        annealIterations: 300,
      });
      expect(result.feasibility).toBe('ok');
      expect(result.variants.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const p = program(['living', 'kitchen', 'bedroom', 'bathroom', 'hall']);
    expect(synthesizePlot(p, 1)).toEqual(synthesizePlot(p, 1));
    expect(JSON.stringify(synthesizePlot(p, 1))).not.toBe(JSON.stringify(synthesizePlot(p, 2)));
  });
});
