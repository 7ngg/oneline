// Zone-first structure for larger programs: rooms group into day / night /
// service zones; the slicing tree splits the footprint between zones FIRST,
// then rooms within each zone. This is what turns "25 boxes" into "a bedroom
// wing, a living side, a service pocket".

import type { RoomSpec, RoomType } from '../program/types';
import type { Rng } from '../rng';
import { randomTree, type SlicingTree } from './slicing';

export type ZoneId = 'day' | 'spine' | 'night' | 'service';

/** Fixed spatial order: the spine (halls) always sits BETWEEN day and night,
 * so both wings border circulation by construction. */
const ZONE_ORDER: ZoneId[] = ['day', 'spine', 'night', 'service'];

export function zoneOfType(type: RoomType): ZoneId {
  switch (type) {
    case 'hall':
    case 'bathroom':
    case 'wc':
      // service core: circulation + wet rooms form the band between wings —
      // one hall alone would be an unbuildable sliver slab, but hall+baths
      // is a real core (and where ResPlan says bathrooms sit anyway)
      return 'spine';
    case 'bedroom':
      return 'night';
    case 'storage':
      return 'service';
    default:
      return 'day';
  }
}

/** Assign each room a zone (see zoneOfType — wet rooms join the spine core). */
export function zonesForRooms(rooms: RoomSpec[]): ZoneId[] {
  return rooms.map((r) => zoneOfType(r.type));
}

export interface ZonedTree {
  tree: SlicingTree;
  /** leaf index → zone rank (index into the zone grouping used). */
  zoneOfLeaf: number[];
  /** roomIndex → allowed leaf indices (its zone's contiguous range). */
  leafRangeOfRoom: Array<[number, number]>;
  /** roomIndex → zone rank, for zone-preserving anneal swaps. */
  zoneOfRoom: number[];
}

/**
 * Build a tree whose top splits separate zones (leaf indices contiguous per
 * zone), with a random subtree inside each zone. Returns null when zoning is
 * pointless (fewer than 2 non-trivial zones).
 */
export function zonedRandomTree(rng: Rng, rooms: RoomSpec[]): ZonedTree | null {
  const zones = zonesForRooms(rooms);
  const groups = new Map<ZoneId, number[]>();
  zones.forEach((z, i) => groups.set(z, [...(groups.get(z) ?? []), i]));
  const nonTrivial = [...groups.entries()].filter(([, idx]) => idx.length > 0);
  if (nonTrivial.length < 2 || rooms.length < 5) return null;

  // fixed seam order — day | spine | night | service — so the hall strip
  // lands between the wings it must serve
  const ordered = nonTrivial.sort(
    (a, b) => ZONE_ORDER.indexOf(a[0]) - ZONE_ORDER.indexOf(b[0]),
  );

  let leafCursor = 0;
  const zoneOfLeaf: number[] = [];
  const leafRangeOfRoom: Array<[number, number]> = new Array(rooms.length);
  const zoneOfRoom: number[] = new Array(rooms.length);
  const subtrees: SlicingTree[] = [];
  ordered.forEach(([, roomIdx], rank) => {
    const start = leafCursor;
    const subtree = offsetLeaves(randomTree(rng, roomIdx.length), start);
    subtrees.push(subtree);
    for (let k = 0; k < roomIdx.length; k++) zoneOfLeaf.push(rank);
    leafCursor += roomIdx.length;
    for (const i of roomIdx) {
      leafRangeOfRoom[i] = [start, leafCursor - 1];
      zoneOfRoom[i] = rank;
    }
  });

  // combine zone subtrees left-to-right with random split directions
  let tree = subtrees[0] as SlicingTree;
  let leaves = countLeaves(tree);
  for (let s = 1; s < subtrees.length; s++) {
    const right = subtrees[s] as SlicingTree;
    const rightLeaves = countLeaves(right);
    tree = {
      kind: 'node',
      dir: rng.bool() ? 'v' : 'h',
      ratio: leaves / (leaves + rightLeaves),
      left: tree,
      right,
      leaves: leaves + rightLeaves,
    };
    leaves += rightLeaves;
  }
  return { tree, zoneOfLeaf, leafRangeOfRoom, zoneOfRoom };
}

const countLeaves = (t: SlicingTree): number => (t.kind === 'leaf' ? 1 : t.leaves);

function offsetLeaves(tree: SlicingTree, offset: number): SlicingTree {
  if (tree.kind === 'leaf') return { kind: 'leaf', index: tree.index + offset };
  return {
    ...tree,
    left: offsetLeaves(tree.left, offset),
    right: offsetLeaves(tree.right, offset),
  };
}
