// Convert a validated NL draft into a real Program. All unit conversion
// happens HERE (the model reports raw {value, unit} pairs). Rooms get
// type-default ranges around the stated ideal; adjacency names map to the
// freshly created room ids; dangling names are dropped and reported.

import { nanoid } from 'nanoid';
import type { NlProgramDraft } from '../engine/schemas/nl';
import type { AdjacencyRule, Program, RoomSpec } from '../engine';
import {
  defaultAreaRange,
  mm,
  mm2,
  MM2_PER_M2,
  MM2_PER_SQFT,
  MM_PER_FT,
  MM_PER_IN,
  MM_PER_M,
  PROGRAM_DEFAULTS,
  DEFAULT_CIRCULATION_FACTOR,
  ROOM_TYPE_DEFAULTS,
} from '../engine';

const AREA_TO_MM2: Record<'m2' | 'sqft', number> = { m2: MM2_PER_M2, sqft: MM2_PER_SQFT };
const LENGTH_TO_MM: Record<'m' | 'cm' | 'mm' | 'ft' | 'in', number> = {
  m: MM_PER_M,
  cm: 10,
  mm: 1,
  ft: MM_PER_FT,
  in: MM_PER_IN,
};

export interface DraftConversion {
  program: Program;
  notes: string[];
}

export function draftToProgram(draft: NlProgramDraft): DraftConversion {
  const notes: string[] = [];
  const rooms: RoomSpec[] = draft.rooms.map((d) => {
    const defaults = ROOM_TYPE_DEFAULTS[d.type];
    const range = defaultAreaRange(d.type);
    let area = range;
    if (d.area) {
      const ideal = mm2(d.area.value * AREA_TO_MM2[d.area.unit]);
      area = {
        min: mm2(Math.min(ideal * 0.75, range.min)),
        ideal,
        max: mm2(Math.max(ideal * 1.35, range.max)),
      };
    }
    // zod .optional() infers `boolean | undefined`; with
    // exactOptionalPropertyTypes we must drop undefined keys, not spread them
    const prefs = { ...defaults.prefs };
    if (d.prefs?.exteriorWall !== undefined) prefs.exteriorWall = d.prefs.exteriorWall;
    if (d.prefs?.orientation !== undefined) prefs.orientation = d.prefs.orientation;
    if (d.prefs?.nearEntrance !== undefined) prefs.nearEntrance = d.prefs.nearEntrance;
    return {
      id: nanoid(8),
      name: d.name,
      type: d.type,
      area,
      minDim: d.minDim ? mm(d.minDim.value * LENGTH_TO_MM[d.minDim.unit]) : defaults.minDim,
      prefs,
    };
  });

  const idByName = new Map(rooms.map((r) => [r.name.toLowerCase(), r.id]));
  const adjacency: AdjacencyRule[] = [];
  for (const rule of draft.adjacency) {
    const a = idByName.get(rule.a.toLowerCase());
    const b = idByName.get(rule.b.toLowerCase());
    if (!a || !b || a === b) {
      notes.push(`Ignored adjacency "${rule.a} ↔ ${rule.b}" — unknown room name.`);
      continue;
    }
    adjacency.push({ a, b, kind: rule.kind, weight: rule.kind === 'required' ? 3 : 2 });
  }

  return {
    program: {
      rooms,
      adjacency,
      circulation: { mode: 'implicit', factor: DEFAULT_CIRCULATION_FACTOR },
      defaults: { ...PROGRAM_DEFAULTS },
    },
    notes,
  };
}

export function plotHintToRect(draft: NlProgramDraft): { w: number; d: number } | null {
  const width = draft.plotHints?.width;
  const depth = draft.plotHints?.depth;
  if (!width || !depth) return null;
  return {
    w: width.value * LENGTH_TO_MM[width.unit],
    d: depth.value * LENGTH_TO_MM[depth.unit],
  };
}
