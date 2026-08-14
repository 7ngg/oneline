// The solver pipeline — a TOTAL function. It never throws: every failure mode
// becomes violations in the result. Determinism: all randomness flows from
// the seed; wall-clock only CUTS work short (flagged SOLVER_TIMEOUT_PARTIAL),
// it never changes decisions, and defaults to disabled (now() = 0) so tests
// and goldens are byte-stable.

import { area2OfPoly } from '../geometry/clip';
import { polyBoundaryLength, ringBbox, type Poly } from '../geometry/polygon';
import { rectFromBbox } from '../geometry/rect';
import { lerp, type Vec } from '../geometry/vec';
import { Rng } from '../rng';
import { mm2 } from '../units';
import { hasErrors, violation, type Violation } from '../violations';
import type { PlanModel, PlanRoom } from '../plan/types';
import { placeFurniture } from '../plan/furniture';
import { placeOpenings } from '../plan/openings';
import { postProcess } from '../plan/postprocess';
import { extractWalls } from '../plan/walls';
import { aspectCapFor } from '../priors/priors';
import { computeFootprint } from '../plot/footprint';
import { validatePlot } from '../plot/validate';
import type { Plot } from '../plot/types';
import { normalizeProgram } from '../program/normalize';
import { countAccessTopologies, sampleAccessTree } from '../program/topology';
import type { Program, RoomSpec } from '../program/types';
import { validateProgram } from '../program/validate';
import { assignRooms, type Assignment } from './assign';
import { checkFeasibility, type FeasibilityVerdict } from './feasibility';
import { anneal } from './anneal';
import { corridorFixture } from './corridor';
import { selectDiverse } from './diversity';
import { score, type ScoredTerms } from './scoring';
import { assembleCells, fitRatios, randomTree, treeToRects, type SlicingTree } from './slicing';
import { zonedRandomTree } from './zones';

export interface GenerateRequest {
  program: Program;
  plot: Plot;
  seed: number;
  /** Number of variants to return. */
  k: number;
  /** Wall-clock safety ceiling; 0/absent hooks.now disables it. */
  budgetMs: number;
  /** Search width/depth overrides (tests use small values). */
  candidateCount?: number;
  annealIterations?: number;
}

export interface GenerateProgress {
  stage: 'validate' | 'candidates' | 'anneal' | 'finalize';
  done: number;
  total: number;
  bestScore: number | null;
}

export interface GenerateResult {
  variants: PlanModel[];
  violations: Violation[];
  feasibility: FeasibilityVerdict | 'blocked';
  cancelled: boolean;
  timedOut: boolean;
}

export interface PipelineHooks {
  onProgress?(p: GenerateProgress): void;
  shouldCancel?(): boolean;
  now?(): number;
}

export interface Candidate {
  tree: SlicingTree;
  /** roomIndex → leafIndex; -1 for rooms with a fixed (carved) cell. */
  assignment: Assignment;
  cells: (Poly | null)[];
  slivers: Poly[];
  terms: ScoredTerms;
  /** Slicing region when it differs from the footprint (corridor carved out). */
  region?: Poly;
  /** Cells outside the slicing tree (e.g. the corridor), spliced by room index. */
  fixedCells?: Array<{ roomIndex: number; cell: Poly }>;
  /** roomIndex → zone rank; anneal swaps stay within a zone when present. */
  zoneOfRoom?: number[];
  /** Topology-first: access-tree edges (parent, child) to realize as walls. */
  targetPairs?: Array<[number, number]>;
}

export function generate(req: GenerateRequest, hooks: PipelineHooks = {}): GenerateResult {
  const onProgress = hooks.onProgress ?? (() => undefined);
  const shouldCancel = hooks.shouldCancel ?? (() => false);
  const now = hooks.now ?? (() => 0);
  const start = now();
  const outOfTime = () => req.budgetMs > 0 && now() - start > req.budgetMs;

  onProgress({ stage: 'validate', done: 0, total: 1, bestScore: null });

  // 1. validate
  const inputViolations = [...validateProgram(req.program), ...validatePlot(req.plot)];
  if (hasErrors(inputViolations)) {
    return { variants: [], violations: inputViolations, feasibility: 'blocked', cancelled: false, timedOut: false };
  }

  // 2. normalize
  const program = normalizeProgram(req.program);
  const footprintResult = computeFootprint(req.plot);
  const violations = [...inputViolations, ...footprintResult.violations];
  const footprint = footprintResult.footprint;
  if (!footprint) {
    return { variants: [], violations, feasibility: 'blocked', cancelled: false, timedOut: false };
  }

  // 3. feasibility
  const feasibility = checkFeasibility(program, req.plot, footprint);
  violations.push(...feasibility.violations);
  if (feasibility.verdict === 'infeasible') {
    return { variants: [], violations, feasibility: 'infeasible', cancelled: false, timedOut: false };
  }

  const rng = new Rng(req.seed);
  const rooms = program.rooms;

  // entrance hint as a world point — feeds assignment bias + entrance scoring
  const entranceVec: Vec | null = (() => {
    if (!req.plot.entrance) return null;
    const a = req.plot.boundary[req.plot.entrance.edgeIndex];
    const b = req.plot.boundary[(req.plot.entrance.edgeIndex + 1) % req.plot.boundary.length];
    return a && b ? lerp(a, b, req.plot.entrance.t) : null;
  })();
  const scoreCells = (cells: (Poly | null)[], targetPairs?: Array<[number, number]>) =>
    score({
      rooms,
      cells,
      adjacency: program.adjacency,
      footprint,
      ...(entranceVec ? { entrance: entranceVec } : {}),
      ...(targetPairs && targetPairs.length > 0 ? { targetPairs } : {}),
    });

  // Honest diversity ceiling (matrix-tree count over the privacy-rule access
  // digraph): when the program structurally admits fewer distinct access
  // topologies than the variants asked for, say so up front instead of
  // reporting a search failure later.
  const topoCeiling = countAccessTopologies(rooms);
  if (topoCeiling > 0n && topoCeiling < BigInt(req.k)) {
    violations.push(
      violation(
        'TOPOLOGY_CEILING',
        'info',
        `This program admits only ${topoCeiling} structurally distinct access ${
          topoCeiling === 1n ? 'topology' : 'topologies'
        } — fewer than the ${req.k} variants requested.`,
        ['program'],
      ),
    );
  }

  // single-room shortcut: the room IS the footprint
  if (rooms.length === 1) {
    const cell = footprint;
    const model = postProcess({
      id: `v${req.seed}x0`,
      seed: req.seed,
      footprint,
      rooms,
      cells: [cell],
      slivers: [],
      scoreTerms: scoreCells([cell]) ?? emptyTerms(),
      program,
      plot: req.plot,
    });
    return { variants: [model], violations, feasibility: feasibility.verdict, cancelled: false, timedOut: false };
  }

  // 4. candidate generation
  const bbox = rectFromBbox(ringBbox(footprint.outer));
  const candidateCount = req.candidateCount ?? 64;
  const discards = { emptyCell: 0, belowMin: 0, tooNarrow: 0, nonFinite: 0 };
  const candidates: Candidate[] = [];
  let cancelled = false;
  let timedOut = false;

  const gateAndScore = (
    tree: SlicingTree,
    assignment: number[],
    region: Poly,
    fixedCells: Array<{ roomIndex: number; cell: Poly }> | undefined,
    zoneOfRoom: number[] | undefined,
    lenient: boolean,
    targetPairs?: Array<[number, number]>,
  ): Candidate | null => {
    const regionBbox = rectFromBbox(ringBbox(region.outer));
    const { cells, slivers } = assembleCells(tree, assignment, region, regionBbox, fixedCells, rooms.length);
    const areaFloor = lenient ? 0.1 : 0.3;
    const dimFloor = lenient ? 0.3 : 0.5;
    for (let i = 0; i < rooms.length; i++) {
      const cell = cells[i];
      const room = rooms[i] as RoomSpec;
      if (!cell) {
        discards.emptyCell++;
        return null;
      }
      if (area2OfPoly(cell) / 2 < room.area.min * areaFloor) {
        discards.belowMin++;
        return null;
      }
      const cb = ringBbox(cell.outer);
      const wSide = cb.maxX - cb.minX;
      const hSide = cb.maxY - cb.minY;
      if (Math.min(wSide, hSide) < room.minDim * dimFloor) {
        discards.tooNarrow++;
        return null;
      }
      // loose sanity gate at candidate birth — the annealer squares rooms up,
      // so exploration needs slack; the REAL per-type cap applies at selection
      if (Math.min(wSide, hSide) > 0 && Math.max(wSide, hSide) / Math.min(wSide, hSide) > (lenient ? 7 : 5)) {
        discards.tooNarrow++;
        return null;
      }
    }
    const terms = scoreCells(cells, targetPairs);
    if (!terms) {
      discards.nonFinite++;
      return null;
    }
    return {
      tree,
      assignment,
      cells,
      slivers,
      terms,
      ...(region !== footprint ? { region } : {}),
      ...(fixedCells && fixedCells.length > 0 ? { fixedCells } : {}),
      ...(zoneOfRoom ? { zoneOfRoom } : {}),
      ...(targetPairs && targetPairs.length > 0 ? { targetPairs } : {}),
    };
  };

  const fitTargets = (tree: SlicingTree, assignment: number[], leafCount: number): SlicingTree => {
    const targetOfLeaf: number[] = new Array<number>(leafCount).fill(0);
    assignment.forEach((leafIdx, roomIdx) => {
      if (leafIdx >= 0) targetOfLeaf[leafIdx] = (rooms[roomIdx] as RoomSpec).area.ideal;
    });
    return fitRatios(tree, targetOfLeaf);
  };

  // family A: unconstrained random slicing (the original generator)
  const makeFree = (candidateRng: Rng, lenient: boolean): Candidate | null => {
    const tree0 = randomTree(candidateRng, rooms.length);
    const rects0 = treeToRects(tree0, bbox);
    const assignment = assignRooms(rooms, rects0, footprint, candidateRng, 4, entranceVec);
    return gateAndScore(fitTargets(tree0, assignment, rooms.length), assignment, footprint, undefined, undefined, lenient);
  };

  // family B: zone-first — top splits separate day/night/service wings
  const makeZoned = (candidateRng: Rng, lenient: boolean): Candidate | null => {
    const zoned = zonedRandomTree(candidateRng, rooms);
    if (!zoned) return null;
    const rects0 = treeToRects(zoned.tree, bbox);
    const allowed = (roomIdx: number, leafIdx: number): boolean => {
      const range = zoned.leafRangeOfRoom[roomIdx];
      return range ? leafIdx >= range[0] && leafIdx <= range[1] : true;
    };
    const assignment = assignRooms(rooms, rects0, footprint, candidateRng, 4, entranceVec, allowed);
    if (assignment.some((leafIdx, roomIdx) => !allowed(roomIdx, leafIdx))) return null;
    return gateAndScore(
      fitTargets(zoned.tree, assignment, rooms.length),
      assignment,
      footprint,
      undefined,
      zoned.zoneOfRoom,
      lenient,
    );
  };

  // family C: corridor-carved — the hall becomes a fixed strip from the
  // entrance inward; remaining rooms slice the leftover region
  const hallIndex = rooms.findIndex((r) => r.type === 'hall');
  const makeCorridor = (candidateRng: Rng, lenient: boolean): Candidate | null => {
    if (hallIndex < 0 || !entranceVec || rooms.length < 5) return null;
    const fixture = corridorFixture(footprint, rooms[hallIndex] as RoomSpec, entranceVec, candidateRng);
    if (!fixture) return null;
    const subsetIdx = rooms.map((_, i) => i).filter((i) => i !== hallIndex);
    const subsetRooms = subsetIdx.map((i) => rooms[i] as RoomSpec);
    const tree0 = randomTree(candidateRng, subsetRooms.length);
    const regionBbox = rectFromBbox(ringBbox(fixture.region.outer));
    const rects0 = treeToRects(tree0, regionBbox);
    const subAssign = assignRooms(subsetRooms, rects0, fixture.region, candidateRng, 4, entranceVec);
    const assignment: number[] = new Array<number>(rooms.length).fill(-1);
    subsetIdx.forEach((roomIdx, pos) => {
      assignment[roomIdx] = subAssign[pos] ?? -1;
    });
    return gateAndScore(
      fitTargets(tree0, assignment, subsetRooms.length),
      assignment,
      fixture.region,
      [{ roomIndex: hallIndex, cell: fixture.hallCell }],
      undefined,
      lenient,
    );
  };

  // family D: topology-first — sample a distinct architect-legal access tree
  // (B01/K02/Z01 parent rules) and let the annealer realize its edges as
  // door-able walls. Diversity by construction: distinct trees, not
  // fingerprint luck.
  const seenTrees = new Set<string>();
  const makeTopology = (candidateRng: Rng, lenient: boolean): Candidate | null => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const parentOf = sampleAccessTree(candidateRng, rooms);
      if (!parentOf) return null;
      const sig = parentOf.join(',');
      if (seenTrees.has(sig) && attempt < 2) continue;
      seenTrees.add(sig);
      const targetPairs: Array<[number, number]> = [];
      parentOf.forEach((p, c) => {
        if (p >= 0) targetPairs.push([p, c]);
      });
      const tree0 = randomTree(candidateRng, rooms.length);
      const rects0 = treeToRects(tree0, bbox);
      const assignment = assignRooms(rooms, rects0, footprint, candidateRng, 4, entranceVec);
      return gateAndScore(
        fitTargets(tree0, assignment, rooms.length),
        assignment,
        footprint,
        undefined,
        undefined,
        lenient,
        targetPairs,
      );
    }
    return null;
  };

  const makeCandidate = (candidateRng: Rng, family: number, lenient: boolean): Candidate | null => {
    if (family === 2) return makeZoned(candidateRng, lenient) ?? makeFree(candidateRng, lenient);
    if (family === 3) {
      return (
        makeCorridor(candidateRng, lenient) ??
        makeZoned(candidateRng, lenient) ??
        makeFree(candidateRng, lenient)
      );
    }
    if (family === 4) return makeTopology(candidateRng, lenient) ?? makeFree(candidateRng, lenient);
    return makeFree(candidateRng, lenient);
  };

  for (let round = 0; round < 2 && candidates.length === 0; round++) {
    const lenient = round === 1;
    for (let i = 0; i < candidateCount; i++) {
      if (shouldCancel()) {
        cancelled = true;
        break;
      }
      if (outOfTime()) {
        timedOut = true;
        break;
      }
      const candidate = makeCandidate(rng.fork(round * candidateCount + i), i % 5, lenient);
      if (candidate) candidates.push(candidate);
      if (i % 8 === 0) {
        onProgress({
          stage: 'candidates',
          done: i,
          total: candidateCount,
          bestScore: candidates.reduce<number | null>((b, c) => Math.max(b ?? 0, c.terms.total), null),
        });
      }
    }
  }

  if (discards.nonFinite > 0) {
    violations.push(
      violation(
        'SOLVER_NONFINITE_SCORES',
        'warning',
        `${discards.nonFinite} layouts produced non-finite scores and were dropped (please report this).`,
        ['program'],
      ),
    );
  }

  if (candidates.length === 0) {
    const worst = Object.entries(discards).sort((a, b) => b[1] - a[1])[0];
    const reasonText: Record<string, string> = {
      emptyCell: 'rooms kept falling outside the buildable footprint',
      belowMin: 'rooms kept coming out below their minimum area',
      tooNarrow: 'rooms kept coming out narrower than their minimum width',
      nonFinite: 'internal scoring failed',
    };
    violations.push(
      violation(
        cancelled ? 'SOLVER_TIMEOUT_PARTIAL' : 'SOLVER_NO_CANDIDATES',
        'error',
        cancelled
          ? 'Generation was cancelled before any layout was found.'
          : `No valid layout found in ${candidateCount * 2} attempts — ${reasonText[worst?.[0] ?? 'belowMin']}. Try relaxing room minimums or enlarging the plot.`,
        ['program'],
      ),
    );
    return { variants: [], violations, feasibility: feasibility.verdict, cancelled, timedOut };
  }

  // 5. anneal top candidates
  candidates.sort((a, b) => b.terms.total - a.terms.total);
  const annealPool = candidates.slice(0, Math.min(8, candidates.length));
  const annealIterations = req.annealIterations ?? 4_000;
  const annealed: Candidate[] = [];
  for (let i = 0; i < annealPool.length; i++) {
    if (shouldCancel()) {
      cancelled = true;
      break;
    }
    if (outOfTime()) {
      timedOut = true;
      break;
    }
    const seedCandidate = annealPool[i] as Candidate;
    annealed.push(
      anneal({
        candidate: seedCandidate,
        rooms,
        adjacency: program.adjacency,
        footprint,
        ...(entranceVec ? { entrance: entranceVec } : {}),
        rng: rng.fork(1_000 + i),
        iterations: annealIterations,
        shouldCancel,
        outOfTime,
        onProgress: (done, total, best) =>
          onProgress({
            stage: 'anneal',
            done: i * annealIterations + done,
            total: annealPool.length * annealIterations,
            bestScore: best,
          }),
      }),
    );
  }
  const pool = annealed.length > 0 ? annealed : annealPool;
  if (timedOut) {
    violations.push(
      violation(
        'SOLVER_TIMEOUT_PARTIAL',
        'info',
        'The time budget ran out — showing the best layouts found so far.',
        ['program'],
      ),
    );
  }

  // 6. hard floors at selection: min-width AND per-type aspect (ResPlan p98
  // + headroom). Band rooms and too-narrow rooms never ship when a compliant
  // layout exists; ships-closest with a warning otherwise.
  const meetsHardFloors = (candidate: Candidate): boolean =>
    candidate.cells.every((cell, i) => {
      if (!cell) return false;
      const room = rooms[i] as RoomSpec;
      const cb = ringBbox(cell.outer);
      const wSide = cb.maxX - cb.minX;
      const hSide = cb.maxY - cb.minY;
      if (Math.min(wSide, hSide) < room.minDim * 0.95) return false;
      if (Math.min(wSide, hSide) > 0 && Math.max(wSide, hSide) / Math.min(wSide, hSide) > aspectCapFor(room.type) * 1.15) {
        return false;
      }
      // NET-area floor: gross minus a conservative wall-inset estimate must
      // clear the room's minimum, or post-processing will stamp the variant
      // with a ROOM_BELOW_MIN_AREA error it can never repair
      const gross = area2OfPoly(cell) / 2;
      const insetEstimate = polyBoundaryLength(cell) * program.defaults.wallInt;
      if (gross - insetEstimate < room.area.min) return false;
      return true;
    });
  const compliant = pool.filter(meetsHardFloors);
  const selectable = compliant.length > 0 ? compliant : pool;
  if (compliant.length === 0 && pool.length > 0) {
    violations.push(
      violation(
        'MIN_DIM_UNSATISFIABLE',
        'warning',
        'No layout met every minimum room width and shape — showing the closest matches.',
        ['program'],
      ),
    );
  }

  // 7. diverse selection, furnishability-aware: a quick primary-furniture
  // placement over each finalist (walls + doors derived on the fly) ranks
  // layouts where the bed/worktop/bath actually stand above ones where they
  // don't. Advisory only — postProcess re-places on the final geometry.
  const specById = new Map<string, RoomSpec>(program.rooms.map((s) => [s.id, s]));
  const furnishRatio = new Map<Candidate, number>();
  for (const candidate of selectable) {
    const liteRooms: PlanRoom[] = [];
    candidate.cells.forEach((cell, i) => {
      if (!cell) return;
      const gross = mm2(area2OfPoly(cell) / 2);
      liteRooms.push({
        id: `q${i}`,
        specId: (rooms[i] as RoomSpec).id,
        poly: cell,
        grossArea: gross,
        netArea: gross,
      });
    });
    const liteWalls = extractWalls(liteRooms, footprint, program.defaults);
    const liteOpenings = placeOpenings(liteRooms, liteWalls, program, req.plot);
    const placed = placeFurniture(liteRooms, liteWalls, liteOpenings.doors, liteOpenings.windows, specById, {
      primariesOnly: true,
    });
    furnishRatio.set(candidate, placed.primaryCount > 0 ? placed.primaryPlaced / placed.primaryCount : 1);
  }
  onProgress({ stage: 'finalize', done: 0, total: 1, bestScore: selectable[0]?.terms.total ?? null });
  const selected = selectDiverse(
    selectable,
    rooms,
    req.k,
    (c) => c.terms.total - 0.08 * (1 - (furnishRatio.get(c) ?? 1)),
  );
  if (selected.length < req.k) {
    violations.push(
      violation(
        'SOLVER_FEW_VARIANTS',
        'info',
        `Only ${selected.length} genuinely distinct layout${selected.length === 1 ? '' : 's'} found (asked for ${req.k}).`,
        ['program'],
      ),
    );
  }

  // 7. post-process into full models (slivers, walls, openings, repair, metrics)
  const variants = selected.map((candidate, i) =>
    postProcess({
      id: `v${req.seed}x${i}`,
      seed: req.seed,
      footprint,
      rooms,
      cells: candidate.cells,
      slivers: candidate.slivers,
      scoreTerms: candidate.terms,
      program,
      plot: req.plot,
    }),
  );

  return { variants, violations, feasibility: feasibility.verdict, cancelled, timedOut };
}

const emptyTerms = (): ScoredTerms => ({
  areaFit: 0,
  adjacency: 0,
  minDim: 0,
  treeFit: 0,
  circulation: 0,
  aspect: 0,
  exposure: 0,
  typicality: 0,
  wetCluster: 0,
  entrance: 0,
  orientation: 0,
  compactness: 0,
  total: 0,
});
