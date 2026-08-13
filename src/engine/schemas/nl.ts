// Contract for the Gemini NL→program draft. STRICT everywhere: hallucinated
// fields fail loudly and trigger the one-retry-with-issues flow. Numbers
// always travel as {value, unit} pairs — the model is never trusted with
// unit conversion; that happens locally in the UI layer.

import { z } from 'zod';

const areaQuantity = z
  .object({
    value: z.number().finite().positive(),
    unit: z.enum(['m2', 'sqft']),
  })
  .strict();

const lengthQuantity = z
  .object({
    value: z.number().finite().positive(),
    unit: z.enum(['m', 'cm', 'mm', 'ft', 'in']),
  })
  .strict();

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

const draftRoomSchema = z
  .object({
    name: z.string().min(1).max(60),
    type: roomTypeSchema,
    area: areaQuantity.optional(),
    minDim: lengthQuantity.optional(),
    prefs: z
      .object({
        exteriorWall: z.boolean().optional(),
        orientation: z.enum(['N', 'E', 'S', 'W']).optional(),
        nearEntrance: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const nlProgramDraftSchema = z
  .object({
    rooms: z.array(draftRoomSchema).min(0).max(30),
    /** Adjacency by room NAME (the model never sees ids). */
    adjacency: z
      .array(
        z
          .object({
            a: z.string(),
            b: z.string(),
            kind: z.enum(['required', 'preferred', 'avoid']),
          })
          .strict(),
      )
      .max(60),
    plotHints: z
      .object({
        width: lengthQuantity.optional(),
        depth: lengthQuantity.optional(),
      })
      .strict()
      .optional(),
    /** REQUIRED: every guess the model made, for the user to review. */
    assumptions: z.array(z.string().max(200)).max(20),
    /** REQUIRED: parts of the input the model could not use. */
    unparsed: z.array(z.string().max(200)).max(20),
  })
  .strict();

export type NlProgramDraft = z.infer<typeof nlProgramDraftSchema>;

export type NlParseOutcome =
  | { ok: true; draft: NlProgramDraft }
  | { ok: false; issues: string[]; salvaged: Partial<NlProgramDraft> | null };

export function parseNlDraft(raw: unknown): NlParseOutcome {
  const result = nlProgramDraftSchema.safeParse(raw);
  if (result.success) return { ok: true, draft: result.data };
  const issues = result.error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  // salvage what partially parses so the manual form can be pre-filled
  let salvaged: Partial<NlProgramDraft> | null = null;
  if (typeof raw === 'object' && raw !== null) {
    const rooms = (raw as Record<string, unknown>)['rooms'];
    if (Array.isArray(rooms)) {
      const good = rooms
        .map((r) => draftRoomSchema.safeParse(r))
        .filter((r): r is { success: true; data: z.infer<typeof draftRoomSchema> } => r.success)
        .map((r) => r.data);
      if (good.length > 0) salvaged = { rooms: good };
    }
  }
  return { ok: false, issues, salvaged };
}

/** OpenAPI-style response schema mirroring nlProgramDraftSchema for Gemini. */
export const NL_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    rooms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          type: {
            type: 'STRING',
            enum: ['living', 'bedroom', 'kitchen', 'bathroom', 'wc', 'hall', 'storage', 'balcony', 'other'],
          },
          area: {
            type: 'OBJECT',
            properties: {
              value: { type: 'NUMBER' },
              unit: { type: 'STRING', enum: ['m2', 'sqft'] },
            },
            required: ['value', 'unit'],
          },
          minDim: {
            type: 'OBJECT',
            properties: {
              value: { type: 'NUMBER' },
              unit: { type: 'STRING', enum: ['m', 'cm', 'mm', 'ft', 'in'] },
            },
            required: ['value', 'unit'],
          },
          prefs: {
            type: 'OBJECT',
            properties: {
              exteriorWall: { type: 'BOOLEAN' },
              orientation: { type: 'STRING', enum: ['N', 'E', 'S', 'W'] },
              nearEntrance: { type: 'BOOLEAN' },
            },
          },
        },
        required: ['name', 'type'],
      },
    },
    adjacency: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          a: { type: 'STRING' },
          b: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['required', 'preferred', 'avoid'] },
        },
        required: ['a', 'b', 'kind'],
      },
    },
    plotHints: {
      type: 'OBJECT',
      properties: {
        width: {
          type: 'OBJECT',
          properties: {
            value: { type: 'NUMBER' },
            unit: { type: 'STRING', enum: ['m', 'cm', 'mm', 'ft', 'in'] },
          },
          required: ['value', 'unit'],
        },
        depth: {
          type: 'OBJECT',
          properties: {
            value: { type: 'NUMBER' },
            unit: { type: 'STRING', enum: ['m', 'cm', 'mm', 'ft', 'in'] },
          },
          required: ['value', 'unit'],
        },
      },
    },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
    unparsed: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['rooms', 'adjacency', 'assumptions', 'unparsed'],
} as const;
