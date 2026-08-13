// Variant diversity: fingerprint = which room-type pairs touch + room
// centroid occupancy on a 4×4 grid. Greedy max-min selection with a distance
// floor — returns FEWER than k rather than padding with near-duplicates.

import { sharedBoundaryLength } from '../geometry/measure';
import { ringBbox, type Poly } from '../geometry/polygon';
import { DOOR_MIN_WIDTH, type RoomSpec } from '../program/types';
import type { Candidate } from './pipeline';

const DISTANCE_FLOOR = 0.12;

interface Fingerprint {
  pairs: Set<string>;
  gridOf: number[]; // room index → 0..15
}

function fingerprint(candidate: Candidate, rooms: RoomSpec[]): Fingerprint {
  const cells = candidate.cells;
  const pairs = new Set<string>();
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i];
      const b = cells[j];
      if (!a || !b) continue;
      if (sharedBoundaryLength(a, b) >= DOOR_MIN_WIDTH) {
        const ta = (rooms[i] as RoomSpec).type;
        const tb = (rooms[j] as RoomSpec).type;
        pairs.add([ta, tb].sort().join('|'));
      }
    }
  }
  const all = cells.filter((c): c is Poly => c !== null);
  if (all.length === 0) return { pairs, gridOf: [] };
  const bounds = all.map((c) => ringBbox(c.outer));
  const minX = Math.min(...bounds.map((b) => b.minX));
  const maxX = Math.max(...bounds.map((b) => b.maxX));
  const minY = Math.min(...bounds.map((b) => b.minY));
  const maxY = Math.max(...bounds.map((b) => b.maxY));
  const gridOf = cells.map((c) => {
    if (!c) return -1;
    const b = ringBbox(c.outer);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const gx = Math.min(3, Math.floor(((cx - minX) / Math.max(1, maxX - minX)) * 4));
    const gy = Math.min(3, Math.floor(((cy - minY) / Math.max(1, maxY - minY)) * 4));
    return gy * 4 + gx;
  });
  return { pairs, gridOf };
}

function distance(a: Fingerprint, b: Fingerprint): number {
  const union = new Set([...a.pairs, ...b.pairs]);
  let common = 0;
  for (const p of a.pairs) if (b.pairs.has(p)) common++;
  const jaccard = union.size > 0 ? 1 - common / union.size : 0;
  let moved = 0;
  const n = Math.max(a.gridOf.length, b.gridOf.length);
  for (let i = 0; i < n; i++) {
    if ((a.gridOf[i] ?? -1) !== (b.gridOf[i] ?? -1)) moved++;
  }
  const displacement = n > 0 ? moved / n : 0;
  return 0.5 * jaccard + 0.5 * displacement;
}

/** Pick up to k candidates, best first, each above the distance floor from all picked. */
export function selectDiverse(pool: Candidate[], rooms: RoomSpec[], k: number): Candidate[] {
  const sorted = [...pool].sort((a, b) => b.terms.total - a.terms.total);
  const picked: Candidate[] = [];
  const prints: Fingerprint[] = [];
  for (const candidate of sorted) {
    if (picked.length >= k) break;
    const print = fingerprint(candidate, rooms);
    if (prints.every((p) => distance(p, print) >= DISTANCE_FLOOR)) {
      picked.push(candidate);
      prints.push(print);
    }
  }
  return picked;
}
