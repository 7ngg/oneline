// Slicing trees: the layout genome. A binary tree over the footprint's
// bounding box; every leaf becomes one room cell after clipping to the
// footprint. Ratios are refit from assigned room area targets, and annealing
// later mutates ratios/directions/assignments.

import { area2OfPoly, cellsForRects } from '../geometry/clip';
import type { Poly } from '../geometry/polygon';
import { rectRing, splitRect, type Rect } from '../geometry/rect';
import { mm } from '../units';
import type { Rng } from '../rng';

export interface SlicingLeaf {
  kind: 'leaf';
  /** Index into the leaf order (assignment maps leaf index → room index). */
  index: number;
}

export interface SlicingNode {
  kind: 'node';
  dir: 'v' | 'h';
  /** Left/bottom share of the parent rect, ∈ [RATIO_MIN, RATIO_MAX]. */
  ratio: number;
  left: SlicingTree;
  right: SlicingTree;
  leaves: number;
}

export type SlicingTree = SlicingLeaf | SlicingNode;

export const RATIO_MIN = 0.12;
export const RATIO_MAX = 0.88;
const CUT_SNAP = 10; // mm
const MIN_SIDE = mm(400);

export const leafCount = (tree: SlicingTree): number => (tree.kind === 'leaf' ? 1 : tree.leaves);

/** Random tree with `n` leaves; leaf indexes assigned in-order. */
export function randomTree(rng: Rng, n: number): SlicingTree {
  let next = 0;
  const build = (count: number): SlicingTree => {
    if (count === 1) return { kind: 'leaf', index: next++ };
    const left = 1 + rng.int(0, count - 2);
    return {
      kind: 'node',
      dir: rng.bool() ? 'v' : 'h',
      ratio: 0.3 + rng.next() * 0.4,
      left: build(left),
      right: build(count - left),
      leaves: count,
    };
  };
  return build(n);
}

/** In-order leaf indexes of a subtree. */
export function subtreeLeaves(tree: SlicingTree): number[] {
  if (tree.kind === 'leaf') return [tree.index];
  return [...subtreeLeaves(tree.left), ...subtreeLeaves(tree.right)];
}

/**
 * Refit every node ratio to the share of assigned target areas in its left
 * subtree — turns a random topology into a first decent guess.
 */
export function fitRatios(tree: SlicingTree, targetOfLeaf: number[]): SlicingTree {
  if (tree.kind === 'leaf') return tree;
  const sum = (t: SlicingTree): number => subtreeLeaves(t).reduce((s, i) => s + (targetOfLeaf[i] ?? 0), 0);
  const leftSum = sum(tree.left);
  const total = leftSum + sum(tree.right);
  const ratio = total > 0 ? Math.min(RATIO_MAX, Math.max(RATIO_MIN, leftSum / total)) : 0.5;
  return {
    ...tree,
    ratio,
    left: fitRatios(tree.left, targetOfLeaf),
    right: fitRatios(tree.right, targetOfLeaf),
  };
}

/** Evaluate the tree into per-leaf rects over `bbox` (leaf-order indexed). */
export function treeToRects(tree: SlicingTree, bbox: Rect): Rect[] {
  const out: Rect[] = new Array<Rect>(leafCount(tree));
  const walk = (t: SlicingTree, r: Rect): void => {
    if (t.kind === 'leaf') {
      out[t.index] = r;
      return;
    }
    const span = t.dir === 'v' ? r.w : r.h;
    const rawAt = (t.dir === 'v' ? r.x : r.y) + span * t.ratio;
    const lo = (t.dir === 'v' ? r.x : r.y) + MIN_SIDE;
    const hi = (t.dir === 'v' ? r.x + r.w : r.y + r.h) - MIN_SIDE;
    const at = mm(Math.min(Math.max(Math.round(rawAt / CUT_SNAP) * CUT_SNAP, lo), hi));
    const [a, b] = splitRect(r, t.dir, at);
    walk(t.left, a);
    walk(t.right, b);
  };
  walk(tree, bbox);
  return out;
}

/**
 * Clip leaf rects to the footprint. A leaf may produce several fragments on
 * concave footprints — the largest fragment is the room cell; other fragments
 * are returned as slivers for the repair stage to absorb.
 */
export function rectsToCells(
  footprint: Poly,
  rects: Rect[],
): { cells: (Poly | null)[]; slivers: Poly[] } {
  const grouped = cellsForRects(
    footprint,
    rects.map((r) => rectRing(r)),
  );
  const cells: (Poly | null)[] = [];
  const slivers: Poly[] = [];
  for (const group of grouped) {
    if (group.length === 0) {
      cells.push(null);
      continue;
    }
    let best = group[0] as Poly;
    let bestArea = -1;
    for (const p of group) {
      const a = Math.abs(areaOf(p));
      if (a > bestArea) {
        bestArea = a;
        best = p;
      }
    }
    cells.push(best);
    for (const p of group) if (p !== best) slivers.push(p);
  }
  return { cells, slivers };
}

const areaOf = (p: Poly): number => area2OfPoly(p);

// --- annealing moves (used in Phase 5, defined with the genome) ---

export type TreePath = number[]; // 0 = left, 1 = right

export function internalNodePaths(tree: SlicingTree, prefix: TreePath = []): TreePath[] {
  if (tree.kind === 'leaf') return [];
  return [
    prefix,
    ...internalNodePaths(tree.left, [...prefix, 0]),
    ...internalNodePaths(tree.right, [...prefix, 1]),
  ];
}

export function mapNode(tree: SlicingTree, path: TreePath, fn: (n: SlicingNode) => SlicingNode): SlicingTree {
  if (path.length === 0) {
    return tree.kind === 'node' ? fn(tree) : tree;
  }
  if (tree.kind === 'leaf') return tree;
  const [head, ...rest] = path;
  return head === 0
    ? { ...tree, left: mapNode(tree.left, rest, fn) }
    : { ...tree, right: mapNode(tree.right, rest, fn) };
}

/** Rotate the subtree at path: ((A B) C) ⇄ (A (B C)) — preserves leaf count. */
export function rotateAt(tree: SlicingTree, path: TreePath): SlicingTree {
  return mapNode(tree, path, (n) => {
    if (n.left.kind === 'node') {
      const l = n.left;
      return {
        kind: 'node',
        dir: n.dir,
        ratio: n.ratio,
        left: l.left,
        right: {
          kind: 'node',
          dir: l.dir,
          ratio: l.ratio,
          left: l.right,
          right: n.right,
          leaves: leafCount(l.right) + leafCount(n.right),
        },
        leaves: n.leaves,
      };
    }
    if (n.right.kind === 'node') {
      const r = n.right;
      return {
        kind: 'node',
        dir: n.dir,
        ratio: n.ratio,
        left: {
          kind: 'node',
          dir: r.dir,
          ratio: r.ratio,
          left: n.left,
          right: r.left,
          leaves: leafCount(n.left) + leafCount(r.left),
        },
        right: r.right,
        leaves: n.leaves,
      };
    }
    return n;
  });
}
