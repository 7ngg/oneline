// "Free imagination" mode: no plot drawn → invent one that fits the program.
// Deterministic per (program, seed): area from the room targets plus
// circulation and wall slack, proportions in the range real flats use, the
// entrance centered on the south edge. The user can always redraw later —
// the synthesized plot lands in the Plot tab like a hand-drawn one.

import { Rng } from '../rng';
import { mm } from '../units';
import { v } from '../geometry/vec';
import type { Program } from '../program/types';
import type { Plot } from './types';

const SNAP = 100; // mm grid for pretty numbers

export function synthesizePlot(program: Program, seed: number): Plot {
  // avalanche the seed first — adjacent raw seeds correlate in xoroshiro's
  // first draws, which collapsed different seeds to identical plots
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  const rng = new Rng(h ^ 0x51ab);
  const totalIdeal = program.rooms.reduce((s, r) => s + r.area.ideal, 0);
  // circulation + wall thickness + fitting slack
  const gross = totalIdeal * (1 + program.circulation.factor) * 1.12;

  // proportions: most flats sit between 1.15:1 and 1.5:1
  const aspect = 1.15 + rng.next() * 0.35;
  let width = Math.sqrt(gross * aspect);
  let depth = gross / width;

  // ensure the narrowest room can exist in either direction
  const maxMinDim = Math.max(...program.rooms.map((r) => r.minDim), 2_400);
  if (depth < maxMinDim * 2.2) {
    depth = maxMinDim * 2.2;
    width = gross / depth;
  }

  const snap = (x: number) => Math.max(SNAP, Math.round(x / SNAP) * SNAP);
  const w = snap(width);
  const d = snap(depth);

  return {
    boundary: [v(0, 0), v(w, 0), v(w, d), v(0, d)],
    setback: { uniform: mm(0) },
    northDeg: 0,
    entrance: { edgeIndex: 0, t: 0.5 },
  };
}
