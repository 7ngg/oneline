// Dexie instance. Table-shape migrations live here (Dexie versioning);
// ProjectFile CONTENT migrations live in engine/schemas/migrate.ts and run on
// every load.

import Dexie, { type EntityTable } from 'dexie';
import type { ProjectFile } from '../engine';

export interface ProjectRecord {
  id: string;
  name: string;
  modifiedAt: string;
  /** Optimistic-concurrency counter for multi-tab conflict detection. */
  rev: number;
  file: ProjectFile;
}

export interface QuarantineRecord {
  id: string;
  raw: string;
  reason: string;
  quarantinedAt: string;
}

export type OnelineDb = Dexie & {
  projects: EntityTable<ProjectRecord, 'id'>;
  quarantine: EntityTable<QuarantineRecord, 'id'>;
};

export function createDb(): OnelineDb {
  const db = new Dexie('oneline') as OnelineDb;
  db.version(1).stores({
    projects: 'id, modifiedAt',
    quarantine: 'id',
  });
  return db;
}
