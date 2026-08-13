// Public API of the engine. Everything outside src/engine imports from here
// (worker, exports, tests); internal modules stay private.

export const ENGINE_VERSION = 1;

// units & rng
export * from './units';
export { Rng } from './rng';

// violations
export * from './violations';

// geometry (the subset app layers need: types, hit-testing, normalization)
export type { Bbox, PointLocation, Poly, Ring } from './geometry/polygon';
export {
  area2,
  bboxSpan,
  isSimpleRing,
  normalizeRing,
  pointInPoly,
  pointInRing,
  poly,
  polyAreaMm2,
  ringAreaMm2,
  ringBbox,
  ringPerimeter,
  selfIntersections,
  signedArea2,
} from './geometry/polygon';
export type { Vec } from './geometry/vec';
export { dist, lerp, v } from './geometry/vec';
export { area2OfPoly, isRectilinear } from './geometry/clip';
export type { Seg } from './geometry/measure';

// program
export * from './program/types';
export {
  DEFAULT_CIRCULATION_FACTOR,
  defaultAreaRange,
  PROGRAM_DEFAULTS,
  ROOM_TYPE_DEFAULTS,
} from './program/defaults';
export { validateProgram } from './program/validate';
export { normalizeProgram } from './program/normalize';

// plot
export * from './plot/types';
export { validatePlot } from './plot/validate';
export { computeFootprint } from './plot/footprint';
export { synthesizePlot } from './plot/synthesize';

// plan
export * from './plan/types';
export { flipDoorSwing, moveWallClamped, slideOpening } from './plan/edit';

// solver
export { generate } from './solver/pipeline';
export type {
  GenerateProgress,
  GenerateRequest,
  GenerateResult,
  PipelineHooks,
} from './solver/pipeline';

// schemas & migration
export {
  parseCurrentProjectFile,
  planModelSchema,
  plotSchema,
  programSchema,
  SCHEMA_VERSION,
} from './schemas/project';
export type { ParseResult, ProjectFile, ProjectFileV1 } from './schemas/project';
export { migrateProjectFile } from './schemas/migrate';
export type { MigrateResult } from './schemas/migrate';
