// The solver pipeline — a TOTAL function. It never throws: every failure mode
// becomes violations in the result. Determinism: all randomness flows from
// the seed; wall-clock only CUTS work short (flagged SOLVER_TIMEOUT_PARTIAL),
// it never changes decisions, and defaults to disabled (now() = 0) so tests
// and goldens are byte-stable.

import { area2OfPoly } from '../geometry/clip';
import { ringBbox, type Poly } from '../geometry/polygon';
import { rectFromBbox } from '../geometry/rect';
import { Rng } from '../rng';
import { hasErrors, violation, type Violation } from '../violations';
import type { PlanModel } from '../plan/types';
import { postProcess } from '../plan/postprocess';
import { computeFootprint } from '../plot/footprint';
import { validatePlot } from '../plot/validate';
import type { Plot } from '../plot/types';
import { normalizeProgram } from '../program/normalize';
import type { Program, RoomSpec } from '../program/types';
import { validateProgram } from '../program/validate';
import { assignRooms, type Assignment } from './assign';
import { checkFeasibility, type FeasibilityVerdict } from './feasibility';
import { anneal } from './anneal';
import { selectDiverse } from './diversity';
import { score, type ScoredTerms } from './scoring';
import { fitRatios, randomTree, rectsToCells, treeToRects, type SlicingTree } from './slicing';

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
  assignment: Assignment;
  cells: (Poly | null)[];
  slivers: Poly[];
  terms: ScoredTerms;
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
      scoreTerms: score({ rooms, cells: [cell], adjacency: program.adjacency, footprint }) ?? emptyTerms(),
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

  const makeCandidate = (candidateRng: Rng, lenient: boolean): Candidate | null => {
    const tree0 = randomTree(candidateRng, rooms.length);
    const rects0 = treeToRects(tree0, bbox);
    const assignment = assignRooms(rooms, rects0, footprint, candidateRng);
    const targetOfLeaf: number[] = new Array<number>(rooms.length).fill(0);
    assignment.forEach((leafIdx, roomIdx) => {
      targetOfLeaf[leafIdx] = (rooms[roomIdx] as RoomSpec).area.ideal;
    });
    const tree = fitRatios(tree0, targetOfLeaf);
    const rects = treeToRects(tree, bbox);
    const { cells: cellsByLeaf, slivers } = rectsToCells(footprint, rects);
    const cells: (Poly | null)[] = assignment.map((leafIdx) => cellsByLeaf[leafIdx] ?? null);

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
      if (Math.min(cb.maxX - cb.minX, cb.maxY - cb.minY) < room.minDim * dimFloor) {
        discards.tooNarrow++;
        return null;
      }
    }
    const terms = score({ rooms, cells, adjacency: program.adjacency, footprint });
    if (!terms) {
      discards.nonFinite++;
      return null;
    }
    return { tree, assignment, cells, slivers, terms };
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
      const candidate = makeCandidate(rng.fork(round * candidateCount + i), lenient);
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
        bbox,
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

  // 6. diverse selection
  onProgress({ stage: 'finalize', done: 0, total: 1, bestScore: pool[0]?.terms.total ?? null });
  const selected = selectDiverse(pool, rooms, req.k);
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
  aspect: 0,
  exposure: 0,
  orientation: 0,
  compactness: 0,
  total: 0,
});
