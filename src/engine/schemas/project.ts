// Versioned ProjectFile schema — the single contract for persistence, JSON
// export/import, and cross-version migration. Strict everywhere: unknown
// fields are rejected with a precise path instead of being silently dropped.

import { z } from 'zod';
import type { PlanModel } from '../plan/types';
import type { Program } from '../program/types';
import type { Plot } from '../plot/types';

export const SCHEMA_VERSION = 1;

const int = z.number().int().finite();
const coord = int.min(-10_000_000).max(10_000_000);
const positiveInt = int.positive();

const vecSchema = z.object({ x: coord, y: coord }).strict();
const ringSchema = z.array(vecSchema).max(200);
const polySchema = z.object({ outer: ringSchema, holes: z.array(ringSchema).max(20) }).strict();

const roomTypeSchema = z.enum([
  'living',
  'bedroom',
  'kitchen',
  'bathroom',
  'wc',
  'hall',
  'storage',
  'balcony',
  'other',
]);

const roomSpecSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().max(120),
    type: roomTypeSchema,
    area: z.object({ min: positiveInt, ideal: positiveInt, max: positiveInt }).strict(),
    minDim: positiveInt,
    prefs: z
      .object({
        exteriorWall: z.boolean().optional(),
        orientation: z.enum(['N', 'E', 'S', 'W']).optional(),
        nearEntrance: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

const adjacencySchema = z
  .object({
    a: z.string(),
    b: z.string(),
    kind: z.enum(['required', 'preferred', 'avoid']),
    weight: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

export const programSchema = z
  .object({
    rooms: z.array(roomSpecSchema).max(64),
    adjacency: z.array(adjacencySchema).max(256),
    circulation: z.object({ mode: z.literal('implicit'), factor: z.number().min(0).max(1) }).strict(),
    defaults: z
      .object({
        wallExt: positiveInt,
        wallInt: positiveInt,
        doorWidth: positiveInt,
        windowWidth: positiveInt,
      })
      .strict(),
  })
  .strict();

export const plotSchema = z
  .object({
    boundary: ringSchema,
    setback: z.union([
      z.object({ uniform: int.min(0) }).strict(),
      z.object({ perEdge: z.array(int.min(0)).max(200) }).strict(),
    ]),
    northDeg: z.number().min(0).max(360),
    entrance: z.object({ edgeIndex: int.min(0), t: z.number().min(0).max(1) }).strict().optional(),
  })
  .strict();

const severitySchema = z.enum(['error', 'warning', 'info']);

const relaxationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('setbackUniform'), value: int }).strict(),
  z.object({ kind: z.literal('roomAreaMin'), roomId: z.string(), value: int }).strict(),
  z.object({ kind: z.literal('roomMinDim'), roomId: z.string(), value: int }).strict(),
  z.object({ kind: z.literal('circulationFactor'), value: z.number() }).strict(),
  z.object({ kind: z.literal('dropAdjacency'), a: z.string(), b: z.string() }).strict(),
]);

const violationSchema = z
  .object({
    code: z.string(),
    severity: severitySchema,
    message: z.string(),
    subjects: z.array(z.string()),
    fix: z.object({ label: z.string(), relaxation: relaxationSchema }).strict().optional(),
  })
  .strict();

const openingBase = {
  id: z.string(),
  wallId: z.string(),
  t0: z.number().min(0).max(1),
  width: positiveInt,
};

const metricsSchema = z
  .object({
    grossFloorArea: int,
    netRoomArea: int,
    circulationArea: int,
    efficiency: z.number(),
    adjacencyScore: z.number(),
    areaFitScore: z.number(),
    daylightScore: z.number(),
    totalScore: z.number(),
    // added after first release — optional so older saves keep parsing
    circulationScore: z.number().optional(),
    wetClusterScore: z.number().optional(),
    entranceScore: z.number().optional(),
  })
  .strict();

export const planModelSchema = z
  .object({
    id: z.string(),
    seed: int,
    footprint: polySchema,
    rooms: z
      .array(
        z
          .object({ id: z.string(), specId: z.string(), poly: polySchema, grossArea: int, netArea: int })
          .strict(),
      )
      .max(64),
    walls: z
      .array(
        z
          .object({
            id: z.string(),
            a: vecSchema,
            b: vecSchema,
            thickness: positiveInt,
            kind: z.enum(['exterior', 'interior']),
            leftRoomId: z.string().nullable(),
            rightRoomId: z.string().nullable(),
          })
          .strict(),
      )
      .max(1024),
    doors: z
      .array(
        z
          .object({
            ...openingBase,
            swing: z.enum(['left', 'right']),
            connects: z.tuple([z.string(), z.union([z.string(), z.literal('outside')])]),
          })
          .strict(),
      )
      .max(256),
    windows: z.array(z.object(openingBase).strict()).max(256),
    violations: z.array(violationSchema).max(256),
    metrics: metricsSchema,
  })
  .strict();

export const projectFileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('oneline/project'),
    id: z.string().min(1),
    name: z.string().max(200),
    createdAt: z.string().datetime(),
    modifiedAt: z.string().datetime(),
    program: programSchema,
    plot: plotSchema,
    variants: z.array(planModelSchema).max(24),
    activeVariantId: z.string().nullable(),
    generation: z
      .object({ seed: int, k: positiveInt.max(12), budgetMs: positiveInt.max(120_000) })
      .strict()
      .nullable(),
  })
  .strict();

export interface ProjectFileV1 {
  schemaVersion: 1;
  kind: 'oneline/project';
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  program: Program;
  plot: Plot;
  variants: PlanModel[];
  activeVariantId: string | null;
  generation: { seed: number; k: number; budgetMs: number } | null;
}

export type ProjectFile = ProjectFileV1;

export type ParseResult =
  | { ok: true; file: ProjectFile }
  | { ok: false; issues: string[] };

/**
 * Parse an untrusted value as the CURRENT schema version. Branded Mm/Mm2 are
 * compile-time-only, so the validated plain numbers cast safely.
 */
export function parseCurrentProjectFile(raw: unknown): ParseResult {
  const result = projectFileV1Schema.safeParse(raw);
  if (result.success) {
    return { ok: true, file: result.data as unknown as ProjectFile };
  }
  return {
    ok: false,
    issues: result.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}
