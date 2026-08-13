// Per-room-type defaults — the one table that seeds the program form and
// normalization. Areas in m² here for readability, converted to Mm² once.
// Bands follow the architect's reference table and corpus measurements from
// design_rules_v4.md (A05 bands adapted to flats, A03 tier ideals, W05/W06
// fixture-derived wet rooms, C03 corridor width); minima are NORM floors.

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
    // A03 tier-1 ideal = mid-band; corpus living rooms measure 26.0–26.6 m²
    areaM2: { min: 14, ideal: 26, max: 40 },
    minDim: mm(3000),
    needsDaylight: true,
    prefs: { exteriorWall: true },
  },
  bedroom: {
    label: 'Bedroom',
    // A05 bedroom band 12–20; corpus bedrooms 14.4–19.8
    areaM2: { min: 9, ideal: 14, max: 20 },
    minDim: mm(2700),
    needsDaylight: true,
    prefs: { exteriorWall: true },
  },
  kitchen: {
    label: 'Kitchen',
    // K03: a kitchen without a connected dining room carries a 2–3 seat nook
    areaM2: { min: 5, ideal: 10, max: 18 },
    minDim: mm(1800),
    needsDaylight: true, // K05 NORM: a windowless kitchen is a violation
    prefs: { exteriorWall: true },
  },
  bathroom: {
    label: 'Bathroom',
    // W05: bath 1500×700 + basin + activity space ≈ 1.7 × 2.4 m ⇒ 4 m² floor
    areaM2: { min: 4, ideal: 5, max: 9 },
    minDim: mm(1500),
    needsDaylight: false,
    prefs: {},
  },
  wc: {
    label: 'WC',
    // W06/A05: guest WC band 1.5–3.5 m², ~1.5 × 2.0 m typical
    areaM2: { min: 1.5, ideal: 2.2, max: 3.5 },
    minDim: mm(900),
    needsDaylight: false,
    prefs: {},
  },
  hall: {
    label: 'Hall',
    // C01: a distribution hall, 9–17% of floor area in measured plans
    areaM2: { min: 2, ideal: 6, max: 18 },
    minDim: mm(1200), // C03 SOURCED: minimum corridor width 1200 mm
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
    // A05 office band 10–20 informs the ideal; min stays low for niches
    areaM2: { min: 4, ideal: 10, max: 20 },
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
