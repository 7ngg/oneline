import { nanoid } from 'nanoid';
import type { ProjectFile } from '../engine';
import type { AppState } from '../state/store';
import { documentOf, emptyPlot, emptyProgram } from '../state/store';

export function createEmptyProjectFile(name: string): ProjectFile {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    kind: 'oneline/project',
    id: nanoid(12),
    name,
    createdAt: now,
    modifiedAt: now,
    program: emptyProgram(),
    plot: emptyPlot(),
    variants: [],
    activeVariantId: null,
    generation: null,
  };
}

/** Snapshot the store into a persistable ProjectFile. */
export function fileFromState(state: AppState): ProjectFile {
  const doc = documentOf(state);
  return {
    schemaVersion: 1,
    kind: 'oneline/project',
    id: state.projectId ?? nanoid(12),
    name: state.projectName,
    createdAt: state.createdAt,
    modifiedAt: new Date().toISOString(),
    ...doc,
  };
}
