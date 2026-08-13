import { describe, expect, it } from 'vitest';
import { mm } from '../units';
import { migrateProjectFile } from './migrate';
import { parseCurrentProjectFile, type ProjectFile } from './project';

const validFile = (): ProjectFile => ({
  schemaVersion: 1,
  kind: 'oneline/project',
  id: 'p1',
  name: 'Test flat',
  createdAt: '2026-08-13T10:00:00.000Z',
  modifiedAt: '2026-08-13T10:00:00.000Z',
  program: {
    rooms: [
      {
        id: 'r1',
        name: 'Living room',
        type: 'living',
        area: { min: 14_000_000, ideal: 22_000_000, max: 40_000_000 } as ProjectFile['program']['rooms'][number]['area'],
        minDim: mm(3000),
        prefs: { exteriorWall: true },
      },
    ],
    adjacency: [],
    circulation: { mode: 'implicit', factor: 0.12 },
    defaults: { wallExt: mm(300), wallInt: mm(100), doorWidth: mm(900), windowWidth: mm(1200) },
  },
  plot: {
    boundary: [
      { x: mm(0), y: mm(0) },
      { x: mm(12_000), y: mm(0) },
      { x: mm(12_000), y: mm(9_000) },
      { x: mm(0), y: mm(9_000) },
    ],
    setback: { uniform: mm(0) },
    northDeg: 0,
  },
  variants: [],
  activeVariantId: null,
  generation: null,
});

describe('project schema', () => {
  it('round-trips a valid file through JSON', () => {
    const file = validFile();
    const parsed = parseCurrentProjectFile(JSON.parse(JSON.stringify(file)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.file).toEqual(file);
  });

  it('rejects unknown fields with a precise path', () => {
    const raw = { ...validFile(), extra: 1 } as unknown;
    const parsed = parseCurrentProjectFile(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.join(' ')).toContain('extra');
  });

  it('rejects non-integer coordinates', () => {
    const file = validFile();
    (file.plot.boundary[0] as { x: number }).x = 0.5;
    const parsed = parseCurrentProjectFile(JSON.parse(JSON.stringify(file)));
    expect(parsed.ok).toBe(false);
  });
});

describe('migrateProjectFile', () => {
  it('accepts a current-version file untouched', () => {
    const result = migrateProjectFile(JSON.parse(JSON.stringify(validFile())));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.migratedFrom).toBeNull();
  });

  it('refuses files from a newer app version', () => {
    const result = migrateProjectFile({ ...validFile(), schemaVersion: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('newer-version');
  });

  it('reports invalid payloads with issues, never throws', () => {
    expect(migrateProjectFile(null).ok).toBe(false);
    expect(migrateProjectFile({ schemaVersion: 1 }).ok).toBe(false);
    expect(migrateProjectFile('garbage').ok).toBe(false);
  });
});
