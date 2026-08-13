// Per-room-type defaults — the one table that seeds the program form and
// normalization. Areas in m² here for readability, converted to Mm² once.

import { mm, mm2FromM2, type Mm, type Mm2 } from '../units';
import type { ProgramDefaults, RoomPrefs, RoomType } from './types';

export interface RoomTypeDefaults {
  label: string;
  areaM2: { min: number; ideal: number; max: number };
  minDim: Mm;
  needsDaylight: boolean;
  prefs: RoomPrefs;
}

export const ROOM_TYPE_DEFAULTS: Record<RoomType, RoomTypeDefaults> = {
  living: {
    label: 'Living room',
    areaM2: { min: 14, ideal: 22, max: 40 },
    minDim: mm(3000),
    needsDaylight: true,
    prefs: { exteriorWall: true },
  },
  bedroom: {
    label: 'Bedroom',
    areaM2: { min: 9, ideal: 13, max: 22 },
    minDim: mm(2700),
    needsDaylight: true,
    prefs: { exteriorWall: true },
  },
  kitchen: {
    label: 'Kitchen',
    areaM2: { min: 5, ideal: 9, max: 16 },
    minDim: mm(1800),
    needsDaylight: true,
    prefs: { exteriorWall: true },
  },
  bathroom: {
    label: 'Bathroom',
    areaM2: { min: 3.5, ideal: 5, max: 9 },
    minDim: mm(1500),
    needsDaylight: false,
    prefs: {},
  },
  wc: {
    label: 'WC',
    areaM2: { min: 1.2, ideal: 1.8, max: 3.5 },
    minDim: mm(900),
    needsDaylight: false,
    prefs: {},
  },
  hall: {
    label: 'Hall',
    areaM2: { min: 2, ideal: 4, max: 12 },
    minDim: mm(1100),
    needsDaylight: false,
    prefs: { nearEntrance: true },
  },
  storage: {
    label: 'Storage',
    areaM2: { min: 1, ideal: 2, max: 6 },
    minDim: mm(800),
    needsDaylight: false,
    prefs: {},
  },
  balcony: {
    label: 'Balcony',
    areaM2: { min: 2, ideal: 4, max: 10 },
    minDim: mm(1200),
    needsDaylight: true,
    prefs: { exteriorWall: true },
  },
  other: {
    label: 'Room',
    areaM2: { min: 4, ideal: 8, max: 20 },
    minDim: mm(1500),
    needsDaylight: false,
    prefs: {},
  },
};

export const defaultAreaRange = (type: RoomType): { min: Mm2; ideal: Mm2; max: Mm2 } => {
  const d = ROOM_TYPE_DEFAULTS[type].areaM2;
  return { min: mm2FromM2(d.min), ideal: mm2FromM2(d.ideal), max: mm2FromM2(d.max) };
};

export const PROGRAM_DEFAULTS: ProgramDefaults = {
  wallExt: mm(300),
  wallInt: mm(100),
  doorWidth: mm(900),
  windowWidth: mm(1200),
};

export const DEFAULT_CIRCULATION_FACTOR = 0.12;
