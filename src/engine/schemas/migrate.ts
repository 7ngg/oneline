// ProjectFile content migration chain. Each step is pure V(n) → V(n+1) and
// fixture-tested; loading always migrates then validates against the current
// schema. Files from NEWER app versions are refused outright — never
// best-effort parsed.

import { parseCurrentProjectFile, SCHEMA_VERSION, type ProjectFile } from './project';

export type MigrateResult =
  | { ok: true; file: ProjectFile; migratedFrom: number | null }
  | { ok: false; reason: 'newer-version' | 'invalid'; issues: string[] };

// Future: const MIGRATIONS: Record<number, (raw: unknown) => unknown> = { 1: v1ToV2 }
const MIGRATIONS: Record<number, (raw: unknown) => unknown> = {};

export function migrateProjectFile(raw: unknown): MigrateResult {
  const version = readVersion(raw);
  if (version === null) {
    return { ok: false, reason: 'invalid', issues: ['missing or invalid schemaVersion'] };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'newer-version',
      issues: [`file was made by a newer version of the app (schema ${version} > ${SCHEMA_VERSION})`],
    };
  }
  let current = raw;
  for (let v = version; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      return { ok: false, reason: 'invalid', issues: [`no migration path from schema ${v}`] };
    }
    current = step(current);
  }
  const parsed = parseCurrentProjectFile(current);
  if (!parsed.ok) {
    return { ok: false, reason: 'invalid', issues: parsed.issues };
  }
  return { ok: true, file: parsed.file, migratedFrom: version === SCHEMA_VERSION ? null : version };
}

function readVersion(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = (raw as Record<string, unknown>)['schemaVersion'];
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}
