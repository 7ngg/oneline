// Convention guards from the sibling project's research notes
// (proj/docs/research/arborescence-count.md §3.6): the published De Leenheer
// worked example plus asymmetric roots that would catch a flipped in/out
// Laplacian, Cayley's formula, and the rule-digraph count itself.

import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { mm, mm2FromM2 } from '../units';
import { accessArcs, bareissDet, countAccessTopologies, sampleAccessTree } from './topology';
import { defaultAreaRange } from './defaults';
import type { RoomSpec, RoomType } from './types';

const room = (id: string, type: RoomType): RoomSpec => ({
  id,
  name: id,
  type,
  area: defaultAreaRange(type),
  minDim: mm(900),
  prefs: {},
});

/** In-degree Laplacian count of out-arborescences rooted at `root`. */
const countArbs = (n: number, arcs: Array<[number, number]>, root: number): bigint => {
  const A: bigint[][] = Array.from({ length: n }, () => new Array<bigint>(n).fill(0n));
  for (const [u, v] of arcs) A[u]![v] = 1n;
  const keep = Array.from({ length: n }, (_, i) => i).filter((i) => i !== root);
  const L = keep.map((i) =>
    keep.map((j) => {
      if (i === j) {
        let indeg = 0n;
        for (let k = 0; k < n; k++) indeg += A[k]![j] as bigint;
        return indeg;
      }
      return -(A[i]![j] as bigint);
    }),
  );
  return bareissDet(L);
};

describe('directed matrix-tree counting', () => {
  // De Leenheer, SIAM Review 62(3):716–726 (2020), Figure 1:
  // arcs v1→v2, v1→v3, v2→v3, v3→v1, v3→v2
  const DL: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
    [2, 0],
    [2, 1],
  ];

  it('reproduces the published De Leenheer answer (2 outgoing trees at v3)', () => {
    expect(countArbs(3, DL, 2)).toBe(2n);
  });

  it('guards the in-degree convention via the asymmetric roots (3 at v1, 1 at v2)', () => {
    // a flipped (out-degree) Laplacian returns the in-tree counts 1 and 3 here
    expect(countArbs(3, DL, 0)).toBe(3n);
    expect(countArbs(3, DL, 1)).toBe(1n);
  });

  it('matches Cayley n^(n-2) on the complete digraph', () => {
    const arcs: Array<[number, number]> = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) if (i !== j) arcs.push([i, j]);
    expect(countArbs(5, arcs, 0)).toBe(125n); // 5^3
  });

  it('returns 0 when a vertex is unreachable', () => {
    expect(countArbs(3, [[0, 1]], 0)).toBe(0n);
  });
});

describe('access-topology ceiling', () => {
  it('counts the product of independent parent choices on a DAG program', () => {
    const rooms = [
      room('hall', 'hall'),
      room('living', 'living'),
      room('kitchen', 'kitchen'),
      room('bed', 'bedroom'),
      room('bath', 'bathroom'),
      room('wc', 'wc'),
      room('store', 'storage'),
    ];
    // parents: hall{outside} living{hall} kitchen{hall,living} bed{hall}
    // bath{hall,bed} wc{hall,living,bed} store{hall,living,kitchen,bed}
    expect(countAccessTopologies(rooms)).toBe(1n * 1n * 2n * 1n * 2n * 3n * 4n);
  });

  it('without a hall the living room carries circulation (K02 else-branch)', () => {
    const rooms = [room('living', 'living'), room('bed', 'bedroom'), room('bath', 'bathroom')];
    // living{outside} bed{living} bath{living,bed} → 2
    expect(countAccessTopologies(rooms)).toBe(2n);
  });

  it('bedrooms never hang off the living room when a hall exists (B01)', () => {
    const rooms = [room('hall', 'hall'), room('living', 'living'), room('bed', 'bedroom')];
    const arcs = accessArcs(rooms);
    expect(arcs).not.toContainEqual([1, 2]); // living → bedroom forbidden
    expect(arcs).toContainEqual([0, 2]); // hall → bedroom allowed
  });
});

describe('sampleAccessTree', () => {
  const rooms = [
    room('hall', 'hall'),
    room('living', 'living'),
    room('kitchen', 'kitchen'),
    room('bed', 'bedroom'),
    room('bath', 'bathroom'),
  ];

  it('is deterministic per seed and picks only legal parents', () => {
    const legal = new Map<number, Set<number>>();
    for (const [p, c] of accessArcs(rooms)) {
      if (!legal.has(c)) legal.set(c, new Set());
      legal.get(c)?.add(p);
    }
    const a = sampleAccessTree(new Rng(7), rooms);
    const b = sampleAccessTree(new Rng(7), rooms);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    a?.forEach((parent, child) => {
      expect(legal.get(child)?.has(parent) ?? false).toBe(true);
    });
  });

  it('area range sanity: defaults produce positive bands', () => {
    const r = defaultAreaRange('wc');
    expect(r.min).toBeGreaterThan(0);
    expect(r.min).toBeLessThanOrEqual(r.ideal);
    expect(r.ideal).toBeLessThanOrEqual(r.max);
    expect(r.min).toBe(mm2FromM2(1.5)); // W06/A05 guest WC floor
  });
});
