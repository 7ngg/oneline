// Project persistence with graceful degradation:
// - IndexedDB unavailable (private mode / policy) → in-memory fallback, app
//   stays fully usable, caller shows a "not saved" banner.
// - Corrupted/unmigratable records → quarantine table, listed as
//   unrecoverable with raw download, never crash the list.
// - Multi-tab: per-record rev counter; saves with a stale rev are rejected.
// - Quota errors surface as 'quota' so the UI can offer export/prune.
// All writes flow through one serialized queue.

import { migrateProjectFile, type ProjectFile } from '../engine';
import { createDb, type OnelineDb, type ProjectRecord, type QuarantineRecord } from './database';

export interface ProjectMeta {
  id: string;
  name: string;
  modifiedAt: string;
  rev: number;
}

export interface QuarantineMeta {
  id: string;
  reason: string;
  quarantinedAt: string;
}

export type SaveResult =
  | { ok: true; rev: number }
  | { ok: false; reason: 'conflict'; currentRev: number }
  | { ok: false; reason: 'quota' }
  | { ok: false; reason: 'error'; detail: string };

export type LoadResult =
  | { ok: true; file: ProjectFile; rev: number; migratedFrom: number | null }
  | { ok: false; reason: 'not-found' }
  | { ok: false; reason: 'quarantined'; detail: string };

export type StorageMode = 'indexeddb' | 'memory';

interface Backend {
  list(): Promise<ProjectMeta[]>;
  listQuarantine(): Promise<QuarantineMeta[]>;
  get(id: string): Promise<ProjectRecord | undefined>;
  put(record: ProjectRecord): Promise<void>;
  delete(id: string): Promise<void>;
  quarantine(record: QuarantineRecord): Promise<void>;
  getQuarantined(id: string): Promise<QuarantineRecord | undefined>;
}

class DexieBackend implements Backend {
  constructor(private db: OnelineDb) {}
  list = async (): Promise<ProjectMeta[]> =>
    (await this.db.projects.orderBy('modifiedAt').reverse().toArray()).map(toMeta);
  listQuarantine = async (): Promise<QuarantineMeta[]> =>
    (await this.db.quarantine.toArray()).map(({ id, reason, quarantinedAt }) => ({
      id,
      reason,
      quarantinedAt,
    }));
  get = (id: string) => this.db.projects.get(id);
  put = async (record: ProjectRecord) => {
    await this.db.projects.put(record);
  };
  delete = async (id: string) => {
    await this.db.projects.delete(id);
  };
  quarantine = async (record: QuarantineRecord) => {
    await this.db.quarantine.put(record);
    await this.db.projects.delete(record.id);
  };
  getQuarantined = (id: string) => this.db.quarantine.get(id);
}

class MemoryBackend implements Backend {
  private projects = new Map<string, ProjectRecord>();
  private quarantined = new Map<string, QuarantineRecord>();
  list = async (): Promise<ProjectMeta[]> =>
    [...this.projects.values()]
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .map(toMeta);
  listQuarantine = async (): Promise<QuarantineMeta[]> =>
    [...this.quarantined.values()].map(({ id, reason, quarantinedAt }) => ({
      id,
      reason,
      quarantinedAt,
    }));
  get = async (id: string) => this.projects.get(id);
  put = async (record: ProjectRecord) => {
    this.projects.set(record.id, record);
  };
  delete = async (id: string) => {
    this.projects.delete(id);
  };
  quarantine = async (record: QuarantineRecord) => {
    this.quarantined.set(record.id, record);
    this.projects.delete(record.id);
  };
  getQuarantined = async (id: string) => this.quarantined.get(id);
}

const toMeta = (r: ProjectRecord): ProjectMeta => ({
  id: r.id,
  name: r.name,
  modifiedAt: r.modifiedAt,
  rev: r.rev,
});

const isQuota = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');

export class ProjectRepo {
  private backend: Backend;
  private queue: Promise<unknown> = Promise.resolve();
  readonly mode: StorageMode;

  private constructor(backend: Backend, mode: StorageMode) {
    this.backend = backend;
    this.mode = mode;
  }

  /** Probes IndexedDB; falls back to memory when unavailable. */
  static async open(): Promise<ProjectRepo> {
    try {
      const db = createDb();
      await db.open();
      return new ProjectRepo(new DexieBackend(db), 'indexeddb');
    } catch {
      return new ProjectRepo(new MemoryBackend(), 'memory');
    }
  }

  static memory(): ProjectRepo {
    return new ProjectRepo(new MemoryBackend(), 'memory');
  }

  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  list(): Promise<ProjectMeta[]> {
    return this.backend.list();
  }

  listQuarantine(): Promise<QuarantineMeta[]> {
    return this.backend.listQuarantine();
  }

  async load(id: string): Promise<LoadResult> {
    const record = await this.backend.get(id);
    if (!record) {
      const q = await this.backend.getQuarantined(id);
      return q ? { ok: false, reason: 'quarantined', detail: q.reason } : { ok: false, reason: 'not-found' };
    }
    const migrated = migrateProjectFile(record.file);
    if (!migrated.ok) {
      const reason = migrated.issues.join('; ');
      await this.serialize(() =>
        this.backend.quarantine({
          id,
          raw: JSON.stringify(record.file),
          reason,
          quarantinedAt: new Date().toISOString(),
        }),
      );
      return { ok: false, reason: 'quarantined', detail: reason };
    }
    return { ok: true, file: migrated.file, rev: record.rev, migratedFrom: migrated.migratedFrom };
  }

  /** expectedRev null = new record (fails on collision with existing id). */
  save(file: ProjectFile, expectedRev: number | null): Promise<SaveResult> {
    return this.serialize(async (): Promise<SaveResult> => {
      try {
        const existing = await this.backend.get(file.id);
        const currentRev = existing?.rev ?? null;
        if (expectedRev !== currentRev) {
          return { ok: false, reason: 'conflict', currentRev: currentRev ?? 0 };
        }
        const rev = (currentRev ?? 0) + 1;
        await this.backend.put({
          id: file.id,
          name: file.name,
          modifiedAt: file.modifiedAt,
          rev,
          file,
        });
        return { ok: true, rev };
      } catch (e) {
        if (isQuota(e)) return { ok: false, reason: 'quota' };
        return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  delete(id: string): Promise<void> {
    return this.serialize(() => this.backend.delete(id));
  }

  async rawQuarantined(id: string): Promise<string | null> {
    return (await this.backend.getQuarantined(id))?.raw ?? null;
  }
}
