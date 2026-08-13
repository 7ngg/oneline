// Root zustand store. The DOCUMENT part (program/plot/variants/generation) is
// what gets persisted and undone; zundo's partialize tracks exactly that
// shape. UI/solver/settings state stays out of history and out of files.

import { temporal } from 'zundo';
import { create } from 'zustand';
import type { PlanModel, Plot, Program, ProjectFile } from '../engine';
import { DEFAULT_CIRCULATION_FACTOR, mm, PROGRAM_DEFAULTS } from '../engine';
import type { StorageMode } from '../db/projectRepo';

export interface DocumentState {
  program: Program;
  plot: Plot;
  variants: PlanModel[];
  activeVariantId: string | null;
  generation: { seed: number; k: number; budgetMs: number } | null;
}

export interface SolverUiState {
  running: boolean;
  progress: number;
  stage: string;
  requestId: number;
  /** Violations from the last generation run (not persisted; regenerate to refresh). */
  violations: import('../engine').Violation[];
  feasibility: 'ok' | 'tight' | 'infeasible' | 'blocked' | null;
}

export type UnitSystem = 'metric' | 'imperial';

export interface AppState extends DocumentState {
  // project meta (not undoable)
  projectId: string | null;
  projectName: string;
  createdAt: string;
  rev: number | null;
  dirty: boolean;
  storageMode: StorageMode;
  conflictRev: number | null;
  banner: string | null;

  solver: SolverUiState;

  unitSystem: UnitSystem;

  // document actions (undoable — they touch DocumentState)
  setProgram(program: Program): void;
  setPlot(plot: Plot): void;
  setVariants(variants: PlanModel[], generation: DocumentState['generation']): void;
  setActiveVariant(id: string | null): void;
  replaceActiveVariant(variant: PlanModel): void;

  // meta actions
  hydrateProject(file: ProjectFile, rev: number | null, storageMode: StorageMode): void;
  setProjectName(name: string): void;
  markSaved(rev: number): void;
  markDirty(): void;
  setConflict(rev: number | null): void;
  setBanner(banner: string | null): void;
  setSolver(update: Partial<SolverUiState>): void;
  setUnitSystem(system: UnitSystem): void;
}

export const emptyProgram = (): Program => ({
  rooms: [],
  adjacency: [],
  circulation: { mode: 'implicit', factor: DEFAULT_CIRCULATION_FACTOR },
  defaults: { ...PROGRAM_DEFAULTS },
});

export const emptyPlot = (): Plot => ({
  boundary: [],
  setback: { uniform: mm(0) },
  northDeg: 0,
});

export const documentOf = (s: AppState): DocumentState => ({
  program: s.program,
  plot: s.plot,
  variants: s.variants,
  activeVariantId: s.activeVariantId,
  generation: s.generation,
});

export const useApp = create<AppState>()(
  temporal(
    (set) => ({
      program: emptyProgram(),
      plot: emptyPlot(),
      variants: [],
      activeVariantId: null,
      generation: null,

      projectId: null,
      projectName: 'Untitled flat',
      createdAt: new Date().toISOString(),
      rev: null,
      dirty: false,
      storageMode: 'memory',
      conflictRev: null,
      banner: null,

      solver: { running: false, progress: 0, stage: '', requestId: 0, violations: [], feasibility: null },

      unitSystem: 'metric',

      setProgram: (program) => set({ program, dirty: true }),
      setPlot: (plot) => set({ plot, dirty: true }),
      setVariants: (variants, generation) =>
        set((s) => ({
          variants,
          generation,
          activeVariantId: variants[0]?.id ?? null,
          dirty: true,
          // keep selection if the variant still exists
          ...(s.activeVariantId && variants.some((v) => v.id === s.activeVariantId)
            ? { activeVariantId: s.activeVariantId }
            : {}),
        })),
      setActiveVariant: (activeVariantId) => set({ activeVariantId }),
      replaceActiveVariant: (variant) =>
        set((s) => ({
          variants: s.variants.map((v) => (v.id === variant.id ? variant : v)),
          dirty: true,
        })),

      hydrateProject: (file, rev, storageMode) =>
        set({
          program: file.program,
          plot: file.plot,
          variants: file.variants,
          activeVariantId: file.activeVariantId,
          generation: file.generation,
          projectId: file.id,
          projectName: file.name,
          createdAt: file.createdAt,
          rev,
          dirty: false,
          storageMode,
          conflictRev: null,
        }),
      setProjectName: (projectName) => set({ projectName, dirty: true }),
      markSaved: (rev) => set({ rev, dirty: false }),
      markDirty: () => set({ dirty: true }),
      setConflict: (conflictRev) => set({ conflictRev }),
      setBanner: (banner) => set({ banner }),
      setSolver: (update) => set((s) => ({ solver: { ...s.solver, ...update } })),
      setUnitSystem: (unitSystem) => {
        set({ unitSystem });
        try {
          localStorage.setItem('oneline.unitSystem', unitSystem);
        } catch {
          // private mode — setting simply won't persist
        }
      },
    }),
    {
      partialize: (state): DocumentState => documentOf(state),
      limit: 100,
      // field-level reference equality: meta/UI updates rebuild the partialized
      // object, and without this every banner change would spam history
      equality: (a, b) =>
        a.program === b.program &&
        a.plot === b.plot &&
        a.variants === b.variants &&
        a.activeVariantId === b.activeVariantId &&
        a.generation === b.generation,
    },
  ),
);

export function initSettings(): void {
  try {
    const stored = localStorage.getItem('oneline.unitSystem');
    if (stored === 'metric' || stored === 'imperial') {
      useApp.setState({ unitSystem: stored });
    }
  } catch {
    // ignore
  }
}

export const useTemporal = () => useApp.temporal;
