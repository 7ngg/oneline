// Wall extraction. Rooms tessellate the footprint with zero-thickness shared
// boundaries; walls are DERIVED unique maximal segments with stable ids:
// 1. split every room edge at every vertex that lies on it (T-junctions)
// 2. group atomic segments by undirected key → left/right rooms
// 3. merge collinear runs with identical (left,right) into maximal walls
// Ordering is fully deterministic (sorted by line key + parameter), so equal
// seeds yield byte-identical wall ids.

import { lineKey } from '../geometry/measure';
import type { Poly, Ring } from '../geometry/polygon';
import { onSegment, vEq, type Vec } from '../geometry/vec';
import type { Mm } from '../units';
import type { ProgramDefaults } from '../program/types';
import type { PlanRoom, Wall } from './types';

interface AtomicSeg {
  a: Vec;
  b: Vec;
  /** Room owning the directed edge a→b (interior on the left, rings CCW). */
  roomId: string;
}

const vertexKey = (p: Vec): string => `${p.x},${p.y}`;
/** Numeric total order on vertices — string compare would order "100" < "99". */
const compareVec = (a: Vec, b: Vec): number => a.x - b.x || a.y - b.y;
const segKey = (a: Vec, b: Vec): string =>
  compareVec(a, b) < 0 ? `${vertexKey(a)}|${vertexKey(b)}` : `${vertexKey(b)}|${vertexKey(a)}`;

function ringEdgesDirected(ring: Ring): Array<[Vec, Vec]> {
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length] as Vec] as [Vec, Vec]);
}

function polyRings(poly: Poly): Ring[] {
  return [poly.outer, ...poly.holes];
}

export function extractWalls(
  rooms: PlanRoom[],
  footprint: Poly,
  defaults: ProgramDefaults,
): Wall[] {
  // 1. collect all vertices for splitting
  const allVertices: Vec[] = [];
  const seen = new Set<string>();
  const push = (p: Vec) => {
    const k = vertexKey(p);
    if (!seen.has(k)) {
      seen.add(k);
      allVertices.push(p);
    }
  };
  for (const room of rooms) for (const ring of polyRings(room.poly)) for (const p of ring) push(p);
  for (const ring of polyRings(footprint)) for (const p of ring) push(p);

  // 2. atomic segments from every room edge, split at foreign vertices
  const atoms: AtomicSeg[] = [];
  for (const room of rooms) {
    for (const ring of polyRings(room.poly)) {
      for (const [a, b] of ringEdgesDirected(ring)) {
        const splits = allVertices
          .filter((p) => !vEq(p, a) && !vEq(p, b) && onSegment(a, b, p))
          .sort((p, q) => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (p.x - q.x) * Math.sign(b.x - a.x) : (p.y - q.y) * Math.sign(b.y - a.y)));
        let prev = a;
        for (const p of splits) {
          atoms.push({ a: prev, b: p, roomId: room.id });
          prev = p;
        }
        atoms.push({ a: prev, b, roomId: room.id });
      }
    }
  }

  // footprint exterior atoms — to classify exterior walls
  const exteriorKeys = new Set<string>();
  for (const ring of polyRings(footprint)) {
    for (const [a, b] of ringEdgesDirected(ring)) {
      const splits = allVertices
        .filter((p) => !vEq(p, a) && !vEq(p, b) && onSegment(a, b, p))
        .sort((p, q) => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (p.x - q.x) * Math.sign(b.x - a.x) : (p.y - q.y) * Math.sign(b.y - a.y)));
      let prev = a;
      for (const p of splits) {
        exteriorKeys.add(segKey(prev, p));
        prev = p;
      }
      exteriorKeys.add(segKey(prev, b));
    }
  }

  // 3. group by undirected key
  interface Grouped {
    a: Vec;
    b: Vec;
    left: string | null;
    right: string | null;
  }
  const groups = new Map<string, Grouped>();
  for (const atom of atoms) {
    const key = segKey(atom.a, atom.b);
    const canonical = compareVec(atom.a, atom.b) < 0;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        a: canonical ? atom.a : atom.b,
        b: canonical ? atom.b : atom.a,
        left: canonical ? atom.roomId : null,
        right: canonical ? null : atom.roomId,
      });
    } else if (canonical) {
      existing.left = atom.roomId;
    } else {
      existing.right = atom.roomId;
    }
  }

  // 4. merge collinear same-pair runs
  interface Run {
    lineId: string;
    param: number;
    seg: Grouped;
  }
  const runs: Run[] = [];
  for (const seg of groups.values()) {
    const lid = lineKey(seg.a, seg.b);
    const param = Math.abs(seg.b.x - seg.a.x) >= Math.abs(seg.b.y - seg.a.y) ? Math.min(seg.a.x, seg.b.x) : Math.min(seg.a.y, seg.b.y);
    runs.push({ lineId: lid, param, seg });
  }
  runs.sort((x, y) => (x.lineId < y.lineId ? -1 : x.lineId > y.lineId ? 1 : x.param - y.param));

  // merge collinear same-pair runs into maximal walls (no closures — keeps
  // TypeScript's flow narrowing simple and the loop allocation-free)
  const merged: Grouped[] = [];
  let currentLine = '';
  for (const run of runs) {
    const seg = run.seg;
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      currentLine === run.lineId &&
      last.left === seg.left &&
      last.right === seg.right &&
      vEq(last.b, seg.a)
    ) {
      last.b = seg.b;
      continue;
    }
    merged.push({ a: seg.a, b: seg.b, left: seg.left, right: seg.right });
    currentLine = run.lineId;
  }

  const isExterior = (seg: Grouped): boolean =>
    seg.left === null || seg.right === null || exteriorKeys.has(segKey(seg.a, seg.b));

  return merged.map((seg, index): Wall => {
    const exterior = isExterior(seg);
    return {
      id: `w${index}`,
      a: seg.a,
      b: seg.b,
      thickness: exterior ? defaults.wallExt : defaults.wallInt,
      kind: exterior ? 'exterior' : 'interior',
      leftRoomId: seg.left,
      rightRoomId: seg.right,
    };
  });
}

export const wallLength = (w: Wall): number => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

/** Extra half-thickness charged to each flanking room for net-area purposes. */
export const wallInsetFor = (w: Wall): Mm => Math.round(w.thickness / 2) as Mm;
