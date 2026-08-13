// Simulated annealing over the slicing genome. Moves: nudge a split ratio,
// flip a split direction, swap two room assignments, rotate a subtree.
// Cancellation/time are checked between fixed-size batches; the best-so-far
// candidate is always returned, and the best-score stream is monotone.

import type { Poly } from '../geometry/polygon';
import type { Rect } from '../geometry/rect';
import type { Rng } from '../rng';
import type { AdjacencyRule, RoomSpec } from '../program/types';
import type { Candidate } from './pipeline';
import { score } from './scoring';
import {
  internalNodePaths,
  mapNode,
  RATIO_MAX,
  RATIO_MIN,
  rectsToCells,
  rotateAt,
  treeToRects,
  type SlicingTree,
} from './slicing';

export interface AnnealInput {
  candidate: Candidate;
  rooms: RoomSpec[];
  adjacency: AdjacencyRule[];
  footprint: Poly;
  bbox: Rect;
  rng: Rng;
  iterations: number;
  shouldCancel(): boolean;
  outOfTime(): boolean;
  onProgress(done: number, total: number, best: number): void;
}

const BATCH = 250;

export function anneal(input: AnnealInput): Candidate {
  const { rooms, adjacency, footprint, bbox, rng, iterations } = input;

  let current = input.candidate;
  let best = current;
  let temperature = 0.08;
  const cooling = Math.pow(0.02 / temperature, 1 / Math.max(1, iterations));

  const evaluate = (tree: SlicingTree, assignment: number[]): Candidate | null => {
    const rects = treeToRects(tree, bbox);
    const { cells: cellsByLeaf, slivers } = rectsToCells(footprint, rects);
    const cells: (Poly | null)[] = assignment.map((leafIdx) => cellsByLeaf[leafIdx] ?? null);
    if (cells.some((c) => c === null)) return null;
    const terms = score({ rooms, cells, adjacency, footprint });
    if (!terms) return null;
    return { tree, assignment, cells, slivers, terms };
  };

  for (let i = 0; i < iterations; i++) {
    if (i % BATCH === 0) {
      if (input.shouldCancel() || input.outOfTime()) break;
      input.onProgress(i, iterations, best.terms.total);
    }

    const mutated = mutate(current, rng);
    const next = evaluate(mutated.tree, mutated.assignment);
    if (next) {
      const delta = next.terms.total - current.terms.total;
      if (delta >= 0 || rng.next() < Math.exp(delta / temperature)) {
        current = next;
        if (current.terms.total > best.terms.total) best = current;
      }
    }
    temperature *= cooling;
  }

  input.onProgress(iterations, iterations, best.terms.total);
  return best;
}

function mutate(candidate: Candidate, rng: Rng): { tree: SlicingTree; assignment: number[] } {
  const move = rng.int(0, 3);
  const paths = internalNodePaths(candidate.tree);
  if (move <= 1 && paths.length > 0) {
    const path = rng.pick(paths);
    if (move === 0) {
      // ratio nudge
      const delta = (rng.next() - 0.5) * 0.16;
      return {
        tree: mapNode(candidate.tree, path, (n) => ({
          ...n,
          ratio: Math.min(RATIO_MAX, Math.max(RATIO_MIN, n.ratio + delta)),
        })),
        assignment: candidate.assignment,
      };
    }
    // direction flip
    return {
      tree: mapNode(candidate.tree, path, (n) => ({ ...n, dir: n.dir === 'v' ? 'h' : 'v' })),
      assignment: candidate.assignment,
    };
  }
  if (move === 2 && candidate.assignment.length >= 2) {
    // swap two room→leaf assignments
    const a = rng.int(0, candidate.assignment.length - 1);
    let b = rng.int(0, candidate.assignment.length - 1);
    if (a === b) b = (b + 1) % candidate.assignment.length;
    const assignment = [...candidate.assignment];
    const tmp = assignment[a] as number;
    assignment[a] = assignment[b] as number;
    assignment[b] = tmp;
    return { tree: candidate.tree, assignment };
  }
  if (paths.length > 0) {
    return { tree: rotateAt(candidate.tree, rng.pick(paths)), assignment: candidate.assignment };
  }
  return { tree: candidate.tree, assignment: candidate.assignment };
}
