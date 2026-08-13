import { parseCurrentProjectFile } from '../../engine';
import { dateStamp, downloadText, safeFilename } from '../../lib/download';
import { fileFromState } from '../../lib/project';
import { useApp } from '../../state/store';

export function exportProjectJson(): void {
  const state = useApp.getState();
  const file = fileFromState(state);
  // belt & braces: never export something the importer would reject
  const check = parseCurrentProjectFile(JSON.parse(JSON.stringify(file)));
  if (!check.ok) {
    state.setBanner(`Export failed schema self-check: ${check.issues[0] ?? 'unknown issue'}`);
    return;
  }
  downloadText(
    JSON.stringify(file, null, 2),
    `${safeFilename(state.projectName)}-${dateStamp()}.oneline.json`,
    'application/json',
  );
}

export async function importProjectJson(fileHandle: File): Promise<void> {
  const state = useApp.getState();
  let raw: unknown;
  try {
    raw = JSON.parse(await fileHandle.text());
  } catch {
    state.setBanner('That file is not valid JSON.');
    return;
  }
  const { migrateProjectFile } = await import('../../engine');
  const result = migrateProjectFile(raw);
  if (!result.ok) {
    state.setBanner(
      result.reason === 'newer-version'
        ? 'This project was made by a newer version of the app — update the app to open it.'
        : `Could not read the project: ${result.issues[0] ?? 'invalid file'}`,
    );
    return;
  }
  const { getRepo } = await import('../projects/projectService');
  const repo = await getRepo();
  // imported file becomes a NEW local project to avoid clobbering ids
  const imported = { ...result.file, id: crypto.randomUUID().slice(0, 12) };
  const saved = await repo.save(imported, null);
  state.hydrateProject(imported, saved.ok ? saved.rev : null, repo.mode);
}
