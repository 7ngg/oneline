// Glue between the repo, the store, and the tab channel. All project
// lifecycle operations funnel through here so autosave, conflicts, and
// banners behave the same from every UI entry point.

import { createTabChannel } from '../../db/tabs';
import { ProjectRepo, type ProjectMeta, type QuarantineMeta } from '../../db/projectRepo';
import type { ProjectFile } from '../../engine';
import { createEmptyProjectFile, fileFromState } from '../../lib/project';
import { useApp } from '../../state/store';

let repoPromise: Promise<ProjectRepo> | null = null;
const tabs = createTabChannel();

export function getRepo(): Promise<ProjectRepo> {
  repoPromise ??= ProjectRepo.open().then((repo) => {
    if (repo.mode === 'memory') {
      useApp
        .getState()
        .setBanner('Local storage is unavailable — work is NOT saved between visits. Export JSON to keep it.');
    }
    return repo;
  });
  return repoPromise;
}

tabs.subscribe((msg) => {
  const state = useApp.getState();
  if (msg.projectId !== state.projectId) return;
  if (msg.type === 'project-deleted') {
    state.setBanner('This project was deleted in another tab.');
    return;
  }
  if (state.rev !== null && msg.rev > state.rev) {
    state.setConflict(msg.rev);
  }
});

export async function listProjects(): Promise<{ projects: ProjectMeta[]; quarantined: QuarantineMeta[] }> {
  const repo = await getRepo();
  const [projects, quarantined] = await Promise.all([repo.list(), repo.listQuarantine()]);
  return { projects, quarantined };
}

export async function openProject(id: string): Promise<boolean> {
  const repo = await getRepo();
  const result = await repo.load(id);
  const state = useApp.getState();
  if (!result.ok) {
    state.setBanner(
      result.reason === 'quarantined'
        ? `Project could not be read (${result.detail}). Its raw data can be downloaded from the project list.`
        : 'Project not found.',
    );
    return false;
  }
  state.hydrateProject(result.file, result.rev, repo.mode);
  useApp.temporal.getState().clear();
  if (result.migratedFrom !== null) {
    state.setBanner(`Project upgraded from schema v${result.migratedFrom}.`);
  }
  return true;
}

/**
 * Startup: reopen the most recently modified project; first visit ever gets
 * the ready-to-generate sample flat instead of a blank form.
 */
export async function openMostRecentOrNew(): Promise<void> {
  const repo = await getRepo();
  const projects = await repo.list();
  const latest = projects[0];
  if (latest && (await openProject(latest.id))) return;
  const { createSampleProjectFile } = await import('../../lib/sampleProject');
  const sample = createSampleProjectFile();
  const saved = await repo.save(sample, null);
  useApp.getState().hydrateProject(sample, saved.ok ? saved.rev : null, repo.mode);
  useApp.temporal.getState().clear();
}

export async function newProject(name = 'Untitled flat'): Promise<void> {
  const repo = await getRepo();
  const file = createEmptyProjectFile(name);
  const saved = await repo.save(file, null);
  const state = useApp.getState();
  state.hydrateProject(file, saved.ok ? saved.rev : null, repo.mode);
  useApp.temporal.getState().clear();
  if (!saved.ok && saved.reason === 'quota') notifyQuota();
}

export async function saveCurrent(): Promise<void> {
  const state = useApp.getState();
  if (!state.projectId || state.conflictRev !== null) return;
  const repo = await getRepo();
  const file = fileFromState(state);
  const result = await repo.save(file, state.rev);
  if (result.ok) {
    state.markSaved(result.rev);
    tabs.post({ type: 'project-changed', projectId: file.id, rev: result.rev });
  } else if (result.reason === 'conflict') {
    state.setConflict(result.currentRev);
  } else if (result.reason === 'quota') {
    notifyQuota();
  } else {
    state.setBanner(`Saving failed: ${result.detail}`);
  }
}

/** Conflict resolution: take the other tab's version. */
export async function reloadTheirs(): Promise<void> {
  const state = useApp.getState();
  if (state.projectId) {
    await openProject(state.projectId);
  }
}

/** Conflict resolution: keep mine as a new copy. */
export async function saveMineAsCopy(): Promise<void> {
  const state = useApp.getState();
  const repo = await getRepo();
  const file = { ...fileFromState(state), id: crypto.randomUUID().slice(0, 12), name: `${state.projectName} (copy)` };
  const saved = await repo.save(file, null);
  if (saved.ok) {
    state.hydrateProject(file, saved.rev, repo.mode);
    state.setBanner('Saved as a copy — the other tab keeps the original.');
  }
}

export async function deleteProject(id: string): Promise<void> {
  const repo = await getRepo();
  await repo.delete(id);
  tabs.post({ type: 'project-deleted', projectId: id, rev: 0 });
}

export async function duplicateProject(id: string): Promise<void> {
  const repo = await getRepo();
  const loaded = await repo.load(id);
  if (!loaded.ok) return;
  const copy: ProjectFile = {
    ...loaded.file,
    id: crypto.randomUUID().slice(0, 12),
    name: `${loaded.file.name} (copy)`,
    modifiedAt: new Date().toISOString(),
  };
  await repo.save(copy, null);
}

export async function rawQuarantined(id: string): Promise<string | null> {
  return (await getRepo()).rawQuarantined(id);
}

function notifyQuota(): void {
  useApp
    .getState()
    .setBanner('Storage is full — autosave failed. Export your project as JSON, or delete old projects.');
}

// ---- autosave: debounce dirty document changes ----

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_MS = 1200;

export function startAutosave(): () => void {
  const unsubscribe = useApp.subscribe((state, prev) => {
    if (!state.dirty || state.projectId === null) return;
    const docChanged =
      state.program !== prev.program ||
      state.plot !== prev.plot ||
      state.variants !== prev.variants ||
      state.activeVariantId !== prev.activeVariantId ||
      state.projectName !== prev.projectName;
    if (!docChanged) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void saveCurrent();
    }, AUTOSAVE_MS);
  });
  return () => {
    unsubscribe();
    if (autosaveTimer) clearTimeout(autosaveTimer);
  };
}
