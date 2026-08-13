// Fixed evaluation suite for placement quality. Shared by the eval test and
// any future benchmarking — change it deliberately, never casually, or
// before/after comparisons stop meaning anything.

import type { Plot } from '../engine/plot/types';
import { defaultAreaRange, PROGRAM_DEFAULTS, ROOM_TYPE_DEFAULTS } from '../engine/program/defaults';
import type { Program, RoomSpec, RoomType } from '../engine/program/types';
import { mm } from '../engine/units';

const room = (id: string, type: RoomType, name?: string): RoomSpec => ({
  id,
  name: name ?? ROOM_TYPE_DEFAULTS[type].label,
  type,
  area: defaultAreaRange(type),
  minDim: ROOM_TYPE_DEFAULTS[type].minDim,
  prefs: { ...ROOM_TYPE_DEFAULTS[type].prefs },
});

const program = (rooms: RoomSpec[], adjacency: Program['adjacency'] = []): Program => ({
  rooms,
  adjacency,
  circulation: { mode: 'implicit', factor: 0.1 },
  defaults: PROGRAM_DEFAULTS,
});

const rectPlot = (w: number, d: number, entranceT = 0.5): Plot => ({
  boundary: [
    { x: mm(0), y: mm(0) },
    { x: mm(w), y: mm(0) },
    { x: mm(w), y: mm(d) },
    { x: mm(0), y: mm(d) },
  ],
  setback: { uniform: mm(0) },
  northDeg: 0,
  entrance: { edgeIndex: 0, t: entranceT },
});

export interface EvalCase {
  name: string;
  program: Program;
  plot: Plot;
}

export const EVAL_SUITE: EvalCase[] = [
  {
    name: 'studio 7x5',
    program: program([room('living', 'living'), room('bath', 'bathroom'), room('hall', 'hall')]),
    plot: rectPlot(7_000, 5_500),
  },
  {
    name: 'one-bed 9x7',
    program: program([
      room('living', 'living'),
      room('kitchen', 'kitchen'),
      room('bed', 'bedroom'),
      room('bath', 'bathroom'),
      room('hall', 'hall'),
    ]),
    plot: rectPlot(9_000, 7_000),
  },
  {
    name: 'two-bed 12x9',
    program: program(
      [
        room('living', 'living'),
        room('kitchen', 'kitchen'),
        room('bed1', 'bedroom', 'Bedroom'),
        room('bed2', 'bedroom', 'Bedroom 2'),
        room('bath', 'bathroom'),
        room('hall', 'hall'),
      ],
      [
        { a: 'hall', b: 'living', kind: 'required', weight: 3 },
        { a: 'living', b: 'kitchen', kind: 'preferred', weight: 2 },
      ],
    ),
    plot: rectPlot(12_000, 9_000),
  },
  {
    name: 'two-bed narrow 15x6',
    program: program([
      room('living', 'living'),
      room('kitchen', 'kitchen'),
      room('bed1', 'bedroom', 'Bedroom'),
      room('bed2', 'bedroom', 'Bedroom 2'),
      room('bath', 'bathroom'),
      room('hall', 'hall'),
    ]),
    plot: rectPlot(15_000, 6_000),
  },
  {
    name: 'three-bed 14x10 with wc',
    program: program([
      room('living', 'living'),
      room('kitchen', 'kitchen'),
      room('bed1', 'bedroom', 'Bedroom'),
      room('bed2', 'bedroom', 'Bedroom 2'),
      room('bed3', 'bedroom', 'Bedroom 3'),
      room('bath', 'bathroom'),
      room('wc', 'wc'),
      room('hall', 'hall'),
    ]),
    plot: rectPlot(14_000, 10_000),
  },
  {
    name: 'l-plot two-bed',
    program: program([
      room('living', 'living'),
      room('kitchen', 'kitchen'),
      room('bed1', 'bedroom', 'Bedroom'),
      room('bed2', 'bedroom', 'Bedroom 2'),
      room('bath', 'bathroom'),
      room('hall', 'hall'),
    ]),
    plot: {
      boundary: [
        { x: mm(0), y: mm(0) },
        { x: mm(14_000), y: mm(0) },
        { x: mm(14_000), y: mm(6_500) },
        { x: mm(8_000), y: mm(6_500) },
        { x: mm(8_000), y: mm(11_000) },
        { x: mm(0), y: mm(11_000) },
      ],
      setback: { uniform: mm(0) },
      northDeg: 0,
      entrance: { edgeIndex: 0, t: 0.3 },
    },
  },
  {
    name: 'deep plot 8x14 (daylight stress)',
    program: program([
      room('living', 'living'),
      room('kitchen', 'kitchen'),
      room('bed1', 'bedroom', 'Bedroom'),
      room('bed2', 'bedroom', 'Bedroom 2'),
      room('bath', 'bathroom'),
      room('hall', 'hall'),
    ]),
    plot: rectPlot(8_000, 14_000),
  },
  {
    name: 'tight squeeze 10x7',
    program: program([
      room('living', 'living'),
      room('kitchen', 'kitchen'),
      room('bed1', 'bedroom', 'Bedroom'),
      room('bed2', 'bedroom', 'Bedroom 2'),
      room('bath', 'bathroom'),
      room('hall', 'hall'),
    ]),
    plot: rectPlot(10_000, 7_000),
  },
];

export const EVAL_SEEDS = [1, 2, 3];
