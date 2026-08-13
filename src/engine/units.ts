// Integer millimetres everywhere inside the engine. Clipper booleans are
// integer-exact, so with Mm coordinates the whole pipeline needs no epsilons:
// a 1 km plot is 1e6 mm and areas reach ~1e12 mm², both far below 2^53.
// The UI converts to m/ft at the formatting layer only.

export type Mm = number & { readonly __mm: unique symbol };
export type Mm2 = number & { readonly __mm2: unique symbol };

export const mm = (n: number): Mm => Math.round(n) as Mm;
export const mm2 = (n: number): Mm2 => Math.round(n) as Mm2;

export const MM_PER_M = 1000;
export const MM2_PER_M2 = 1_000_000;
export const MM_PER_FT = 304.8;
export const MM_PER_IN = 25.4;
export const MM2_PER_SQFT = 92_903.04;

export const mmFromM = (m: number): Mm => mm(m * MM_PER_M);
export const mmFromFt = (ft: number, inch = 0): Mm => mm(ft * MM_PER_FT + inch * MM_PER_IN);
export const mm2FromM2 = (m2: number): Mm2 => mm2(m2 * MM2_PER_M2);
export const mm2FromSqft = (sqft: number): Mm2 => mm2(sqft * MM2_PER_SQFT);

export const mFromMm = (l: Mm): number => l / MM_PER_M;
export const m2FromMm2 = (a: Mm2): number => a / MM2_PER_M2;
export const ftFromMm = (l: Mm): number => l / MM_PER_FT;
export const sqftFromMm2 = (a: Mm2): number => a / MM2_PER_SQFT;

export const addMm2 = (a: Mm2, b: Mm2): Mm2 => (a + b) as Mm2;
export const isIntegerMm = (n: number): boolean => Number.isInteger(n) && Number.isFinite(n);
