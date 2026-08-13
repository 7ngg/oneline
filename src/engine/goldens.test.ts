// Golden-file tests: full pipeline output for fixed (program, plot, seed)
// triples, committed as JSON. Any engine change that alters layouts shows up
// as a reviewable diff; update deliberately with `npm run goldens:update`.

import { describe, expect, it } from 'vitest';
import type { Plot } from './plot/types';
import { defaultAreaRange, PROGRAM_DEFAULTS, ROOM_TYPE_DEFAULTS } from './program/defaults';
import type { Program, RoomSpec, RoomType } from './program/types';
import { generate } from './solver/pipeline';
import { mm } from './units';

const room = (id: string, type: RoomType): RoomSpec => ({
  id,
  name: ROOM_TYPE_DEFAULTS[type].label,
  type,
  area: defaultAreaRange(type),
  minDim: ROOM_TYPE_DEFAULTS[type].minDim,
  prefs: { ...ROOM_TYPE_DEFAULTS[type].prefs },
});

const rectBoundary = (w: number, d: number): Plot['boundary'] => [
  { x: mm(0), y: mm(0) },
  { x: mm(w), y: mm(0) },
  { x: mm(w), y: mm(d) },
  { x: mm(0), y: mm(d) },
];

interface Sample {
  name: string;
  program: Program;
  plot: Plot;
}

const SAMPLES: Sample[] = [
  {
    name: 'studio',
    program: {
      rooms: [room('living', 'living'), room('bath', 'bathroom'), room('hall', 'hall')],
      adjacency: [{ a: 'hall', b: 'bath', kind: 'required', weight: 2 }],
      circulation: { mode: 'implicit', factor: 0.08 },
      defaults: PROGRAM_DEFAULTS,
    },
    plot: {
      boundary: rectBoundary(8_000, 6_000),
      setback: { uniform: mm(0) },
      northDeg: 0,
      entrance: { edgeIndex: 0, t: 0.3 },
    },
  },
  {
    name: 'two-bed',
    program: {
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
      ],
      circulation: { mode: 'implicit', factor: 0.1 },
      defaults: PROGRAM_DEFAULTS,
    },
    plot: {
      boundary: rectBoundary(13_000, 9_000),
      setback: { uniform: mm(500) },
      northDeg: 0,
      entrance: { edgeIndex: 0, t: 0.5 },
    },
  },
  {
    name: 'l-shape',
    program: {
      rooms: [
        room('living', 'living'),
        room('kitchen', 'kitchen'),
        room('bed1', 'bedroom'),
        room('bath', 'bathroom'),
      ],
      adjacency: [],
      circulation: { mode: 'implicit', factor: 0.1 },
      defaults: PROGRAM_DEFAULTS,
    },
    plot: {
      boundary: [
        { x: mm(0), y: mm(0) },
        { x: mm(12_000), y: mm(0) },
        { x: mm(12_000), y: mm(6_000) },
        { x: mm(7_000), y: mm(6_000) },
        { x: mm(7_000), y: mm(10_000) },
        { x: mm(0), y: mm(10_000) },
      ],
      setback: { uniform: mm(0) },
      northDeg: 0,
    },
  },
];

describe('goldens', () => {
  for (const sample of SAMPLES) {
    for (const seed of [1, 2]) {
      it(`${sample.name} seed ${seed}`, async () => {
        const result = generate({
          program: sample.program,
          plot: sample.plot,
          seed,
          k: 3,
          budgetMs: 0,
          candidateCount: 24,
          annealIterations: 600,
        });
        await expect(JSON.stringify(result, null, 2)).toMatchFileSnapshot(
          `../test/goldens/${sample.name}-seed${seed}.json`,
        );
      });
    }
  }
});
