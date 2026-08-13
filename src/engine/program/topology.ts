// Access-topology counting and sampling.
//
// A finished plan's door graph is a spanning tree rooted at the outside
// (entrance), plus extra ring doors. Which trees are ARCHITECTURALLY legal is
// decided by privacy rules (design_rules_v4: B01 — no bedroom through a
// habitable room; K02 — kitchen not through the living room unless the living
// room IS the circulation; Z01 — service rooms belong to the zone they
// serve). Those rules induce a digraph of "may be the access parent of";
// spanning arborescences of that digraph, rooted at the outside, are exactly
// the distinct access topologies the program admits.
//
// Counting them is Tutte's directed matrix-tree theorem: L = D_in − A, delete
// the root row/column, take the determinant (De Leenheer, SIAM Review 62(3),
// 2020, Theorem 1 — the L₁/out-tree form). Counts overflow doubles fast, so
// the determinant runs in BigInt via Bareiss fraction-free elimination
// (Bareiss 1968): every intermediate is a minor of the original integer
// matrix, so every division is exact.

import type { Rng } from '../rng';
import type { RoomSpec } from './types';

// Rank ladder (documentation): outside 0 → hall 1 → living 2 →
// kitchen/bedroom/other 3 → bathroom/wc/storage/balcony 4. Leaves parent
// nothing, so the digraph below is acyclic by construction.

/**
 * Allowed access-parent arcs, room index → list of children indices.
 * Node -1 is the outside (the carrier); it parents halls (or livings when
 * the program has no hall — K02's else-branch: the living room IS the
 * circulation there).
 */
export function accessArcs(rooms: RoomSpec[]): Array<[number, number]> {
  const arcs: Array<[number, number]> = [];
  const halls: number[] = [];
  const livings: number[] = [];
  rooms.forEach((r, i) => {
    if (r.type === 'hall') halls.push(i);
    if (r.type === 'living') livings.push(i);
  });
  const hasHall = halls.length > 0;

  // outside → distribution space
  if (hasHall) for (const h of halls) arcs.push([-1, h]);
  else if (livings.length > 0) for (const l of livings) arcs.push([-1, l]);
  else if (rooms.length > 0) arcs.push([-1, 0]);

  for (let p = 0; p < rooms.length; p++) {
    const pt = (rooms[p] as RoomSpec).type;
    for (let c = 0; c < rooms.length; c++) {
      if (p === c) continue;
      const ct = (rooms[c] as RoomSpec).type;
      let ok = false;
      if (pt === 'hall') {
        // C06: the hall carries everything; hall chains only forward (p<c)
        ok = ct !== 'hall' || p < c;
      } else if (pt === 'living') {
        // B01: bedrooms/bathrooms hang off the living room only when there is
        // no hall (then the living room is the circulation — C06/K02)
        ok = ct === 'kitchen' || ct === 'other' || ct === 'wc' || ct === 'storage' || ct === 'balcony'
          || (!hasHall && (ct === 'bedroom' || ct === 'bathroom'));
      } else if (pt === 'kitchen') {
        ok = ct === 'storage' || ct === 'balcony' || ct === 'other'; // K01 core: pantry stays attached
      } else if (pt === 'bedroom') {
        ok = ct === 'bathroom' || ct === 'wc' || ct === 'storage' || ct === 'balcony'; // ensuite / wardrobe (B03, B07)
      }
      // acyclic by construction: bathroom/wc/storage/balcony/other parent
      // nothing, kitchen/bedroom only parent leaves, hall chains forward
      if (ok) arcs.push([p, c]);
    }
  }
  return arcs;
}

/**
 * Exact number of spanning access arborescences rooted at the outside.
 * 0n = the rule digraph cannot reach every room (e.g. exotic programs with
 * no hall and no living); callers should treat 0n as "no statement".
 */
export function countAccessTopologies(rooms: RoomSpec[]): bigint {
  const n = rooms.length + 1; // + outside at index rooms.length
  if (rooms.length === 0) return 0n;
  const idx = (i: number): number => (i < 0 ? rooms.length : i);
  const A: bigint[][] = Array.from({ length: n }, () => new Array<bigint>(n).fill(0n));
  for (const [u, v] of accessArcs(rooms)) A[idx(u)]![idx(v)] = 1n;
  // L = D_in − A, drop the outside row/column
  const keep = rooms.map((_, i) => i);
  const L: bigint[][] = keep.map((i) =>
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
}

/** Exact integer determinant — Bareiss one-step fraction-free elimination. */
export function bareissDet(M: bigint[][]): bigint {
  const n = M.length;
  if (n === 0) return 1n;
  const A = M.map((row) => [...row]);
  let sign = 1n;
  let prev = 1n;
  for (let k = 0; k < n - 1; k++) {
    if (A[k]![k] === 0n) {
      let piv = -1;
      for (let i = k + 1; i < n; i++) {
        if (A[i]![k] !== 0n) {
          piv = i;
          break;
        }
      }
      if (piv < 0) return 0n;
      const tmp = A[k] as bigint[];
      A[k] = A[piv] as bigint[];
      A[piv] = tmp;
      sign = -sign;
    }
    const akk = A[k]![k] as bigint;
    for (let i = k + 1; i < n; i++) {
      const aik = A[i]![k] as bigint;
      for (let j = k + 1; j < n; j++) {
        // exact by Bareiss eq. (3): the quotient is a minor of the original
        A[i]![j] = ((A[i]![j] as bigint) * akk - aik * (A[k]![j] as bigint)) / prev;
      }
    }
    prev = akk;
  }
  return sign * (A[n - 1]![n - 1] as bigint);
}

/**
 * Sample one access tree: parentOf[roomIndex] = parent room index, -1 for
 * the outside-parented root(s). Rooms the rule digraph leaves parentless
 * fall back to the first hall, else first living, else room 0 — the tree is
 * always total, and always acyclic (parents outrank children).
 */
export function sampleAccessTree(rng: Rng, rooms: RoomSpec[]): number[] | null {
  if (rooms.length < 2) return null;
  const parentsOf: number[][] = rooms.map(() => []);
  for (const [p, c] of accessArcs(rooms)) parentsOf[c]?.push(p);
  const hallIdx = rooms.findIndex((r) => r.type === 'hall');
  const livingIdx = rooms.findIndex((r) => r.type === 'living');
  const fallback = hallIdx >= 0 ? hallIdx : livingIdx >= 0 ? livingIdx : 0;
  return rooms.map((_, i) => {
    const options = parentsOf[i] as number[];
    if (options.length === 0) return i === fallback ? -1 : fallback;
    return options.length === 1 ? (options[0] as number) : rng.pick(options);
  });
}
