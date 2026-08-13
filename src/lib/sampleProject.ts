// First-run starter project: a ready-to-generate 2-bed flat so the first
// click on Generate succeeds instead of greeting new users with a blank form.

import { nanoid } from 'nanoid';
import type { ProjectFile, RoomSpec, RoomType } from '../engine';
import {
  defaultAreaRange,
  DEFAULT_CIRCULATION_FACTOR,
  mm,
  PROGRAM_DEFAULTS,
  ROOM_TYPE_DEFAULTS,
  v,
} from '../engine';

const room = (type: RoomType, name?: string): RoomSpec => ({
  id: nanoid(8),
  name: name ?? ROOM_TYPE_DEFAULTS[type].label,
  type,
  area: defaultAreaRange(type),
  minDim: ROOM_TYPE_DEFAULTS[type].minDim,
  prefs: { ...ROOM_TYPE_DEFAULTS[type].prefs },
});

export function createSampleProjectFile(): ProjectFile {
  const now = new Date().toISOString();
  const rooms = [
    room('living'),
    room('kitchen'),
    room('bedroom', 'Bedroom'),
    room('bedroom', 'Bedroom 2'),
    room('bathroom'),
    room('hall'),
  ];
  const idOf = (name: string) => rooms.find((r) => r.name === name)?.id ?? '';
  return {
    schemaVersion: 1,
    kind: 'oneline/project',
    id: nanoid(12),
    name: 'Sample flat',
    createdAt: now,
    modifiedAt: now,
    program: {
      rooms,
      adjacency: [
        { a: idOf('Hall'), b: idOf('Living room'), kind: 'required', weight: 3 },
        { a: idOf('Living room'), b: idOf('Kitchen'), kind: 'preferred', weight: 2 },
        { a: idOf('Hall'), b: idOf('Bathroom'), kind: 'preferred', weight: 2 },
      ],
      circulation: { mode: 'implicit', factor: DEFAULT_CIRCULATION_FACTOR },
      defaults: { ...PROGRAM_DEFAULTS },
    },
    plot: {
      boundary: [v(0, 0), v(13_000, 0), v(13_000, 9_000), v(0, 9_000)],
      setback: { uniform: mm(0) },
      northDeg: 0,
      entrance: { edgeIndex: 0, t: 0.5 },
    },
    variants: [],
    activeVariantId: null,
    generation: null,
  };
}
