// Simulated annealing over the slicing genome. Moves: nudge a split ratio,
// flip a split direction, swap two room assignments, rotate a subtree.
// Cancellation/time are checked between fixed-size batches; the best-so-far
// candidate is always returned, and the best-score stream is monotone.

import { ringBbox, type Poly } from '../geometry/polygon';
import { rectFromBbox } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import type { Rng } from '../rng';
import type { AdjacencyRule, RoomSpec } from '../program/types';
import type { Candidate } from './pipeline';
import { score } from './scoring';
import {
  assembleCells,
  internalNodePaths,
  mapNode,
  RATIO_MAX,
  RATIO_MIN,
  rotateAt,
  type SlicingTree,
} from './slicing';

export interface AnnealInput {
  candidate: Candidate;
  rooms: RoomSpec[];
  adjacency: AdjacencyRule[];
  footprint: Poly;
  entrance?: Vec;
  rng: Rng;
  iterations: number;
  shouldCancel(): boolean;
  outOfTime(): boolean;
  onProgress(done: number, total: number, best: number): void;
}

const BATCH = 250;

export function anneal(input: AnnealInput): Candidate {
  const { rooms, adjacency, footprint, rng, iterations } = input;

  let current = input.candidate;
  let best = current;
  let temperature = 0.08;
  const cooling = Math.pow(0.02 / temperature, 1 / Math.max(1, iterations));

  // corridor candidates slice a sub-region with the hall spliced in as a
  // fixed cell; free/zoned candidates slice the whole footprint
  const region = current.region ?? footprint;
  const regionBbox = rectFromBbox(ringBbox(region.outer));
  const fixedCells = current.fixedCells;
  const zoneOfRoom = current.zoneOfRoom;
  const targetPairs = current.targetPairs;

  const evaluate = (tree: SlicingTree, assignment: number[]): Candidate | null => {
    const { cells, slivers } = assembleCells(tree, assignment, region, regionBbox, fixedCells, rooms.length);
    if (cells.some((c) => c === null)) return null;
    const terms = score({
      rooms,
      cells,
      adjacency,
      footprint,
      ...(input.entrance ? { entrance: input.entrance } : {}),
      ...(targetPairs && targetPairs.length > 0 ? { targetPairs } : {}),
    });
    if (!terms) return null;
    return {
      tree,
      assignment,
      cells,
      slivers,
      terms,
      ...(current.region ? { region: current.region } : {}),
      ...(fixedCells ? { fixedCells } : {}),
      ...(zoneOfRoom ? { zoneOfRoom } : {}),
      ...(targetPairs ? { targetPairs } : {}),
    };
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
  // ratio nudges are the primary area-fit lever — half of all moves;
  // fine nudges polish, coarse nudges escape local optima
  const move = rng.int(0, 5);
  const paths = internalNodePaths(candidate.tree);
  if (move <= 2 && paths.length > 0) {
    const path = rng.pick(paths);
    const magnitude = move === 0 ? 0.04 : 0.16;
    const delta = (rng.next() - 0.5) * magnitude;
    return {
      tree: mapNode(candidate.tree, path, (n) => ({
        ...n,
        ratio: Math.min(RATIO_MAX, Math.max(RATIO_MIN, n.ratio + delta)),
      })),
      assignment: candidate.assignment,
    };
  }
  if (move === 3 && paths.length > 0) {
    // direction flip
    return {
      tree: mapNode(candidate.tree, rng.pick(paths), (n) => ({ ...n, dir: n.dir === 'v' ? 'h' : 'v' })),
      assignment: candidate.assignment,
    };
  }
  if (move === 4 && candidate.assignment.length >= 2) {
    // swap two room→leaf assignments — never fixed cells, never across zones
    const swappable = candidate.assignment
      .map((leafIdx, roomIdx) => ({ leafIdx, roomIdx }))
      .filter(({ leafIdx }) => leafIdx >= 0);
    if (swappable.length >= 2) {
      const first = rng.pick(swappable);
      const partners = swappable.filter(
        ({ roomIdx }) =>
          roomIdx !== first.roomIdx &&
          (!candidate.zoneOfRoom || candidate.zoneOfRoom[roomIdx] === candidate.zoneOfRoom[first.roomIdx]),
      );
      if (partners.length > 0) {
        const second = rng.pick(partners);
        const assignment = [...candidate.assignment];
        assignment[first.roomIdx] = second.leafIdx;
        assignment[second.roomIdx] = first.leafIdx;
        return { tree: candidate.tree, assignment };
      }
    }
    return { tree: candidate.tree, assignment: candidate.assignment };
  }
  if (paths.length > 0) {
    return { tree: rotateAt(candidate.tree, rng.pick(paths)), assignment: candidate.assignment };
  }
  return { tree: candidate.tree, assignment: candidate.assignment };
}
