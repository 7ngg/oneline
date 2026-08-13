// Single seeded RNG for the whole engine. Every random decision flows through
// an explicit Rng instance (never Math.random / Date.now), so identical seeds
// produce byte-identical PlanModels — the basis for golden tests and the
// "re-run last generation" feature.

import { uniformIntDistribution, xoroshiro128plus, type RandomGenerator } from 'pure-rand';

export class Rng {
  private g: RandomGenerator;

  constructor(seed: number) {
    this.g = xoroshiro128plus(seed | 0);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.int(0, 0xffffffff) / 0x1_0000_0000;
  }

  /** Uniform integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number {
    const [v, ng] = uniformIntDistribution(lo, hi)(this.g);
    this.g = ng;
    return v;
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('Rng.pick on empty array');
    return arr[this.int(0, arr.length - 1)] as T;
  }

  /** In-place Fisher–Yates shuffle; returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * Independent child stream. Consumes one draw from this stream, so fork
   * order matters and is deterministic.
   */
  fork(stream: number): Rng {
    return new Rng(this.int(0, 0x7fffffff) ^ Math.imul(stream, 0x9e3779b9));
  }
}
