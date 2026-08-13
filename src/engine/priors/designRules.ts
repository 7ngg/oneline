// Architect-vetted design constants, transplanted from the sibling project's
// rule base (proj/docs/design_rules_v4.md — 7 measured plans, SNiP + Neufert
// sourced, architect-ruled). Each constant cites its rule ID so provenance
// survives refactors. Everything in engine units (mm, mm²).

/** C02 (BINDING): corridor/hall proportion cap — beyond 4:1 it's a tunnel. */
export const CORRIDOR_MAX_ASPECT = 4;

/** C03 (SOURCED): minimum corridor clear width. */
export const CORRIDOR_MIN_WIDTH = 1_200;

/**
 * D02 (NORM): glazing area follows room floor area — roughly 1/10 for
 * daylight + natural ventilation.
 */
export const WINDOW_AREA_RATIO = 0.1;

/**
 * D06 (OBSERVED, plans 02/03 title block): sill 1000, head 1800 → 800 mm of
 * glazing height available for the D02 ratio calculation.
 */
export const GLAZING_HEIGHT = 800;
export const WINDOW_MIN_WIDTH = 600;
export const WINDOW_MAX_WIDTH = 3_600;

/**
 * Do04 (SOURCED): in small rooms (WCs, tight bathrooms) side-hung doors open
 * OUTWARDS. Applied below this floor area (mm²).
 */
export const OUTWARD_SWING_MAX_AREA = 3_500_000; // 3.5 m²

/**
 * A02/A03 (BINDING): surplus-distribution tiers. Tier 1 social absorbs
 * surplus toward ideal first; tier 3 ancillary stays pinned at minimum.
 * ideal = min + f(tier) × (max − min), f = [½, ¼, 0].
 */
export const AREA_TIER: Record<string, 1 | 2 | 3> = {
  living: 1,
  kitchen: 1,
  bedroom: 2,
  other: 2,
  balcony: 3,
  bathroom: 3,
  wc: 3,
  storage: 3,
  hall: 3,
};
export const TIER_IDEAL_FRACTION: Record<1 | 2 | 3, number> = { 1: 0.5, 2: 0.25, 3: 0 };
