// Placement-quality benchmark. Prints an aggregate report over the fixed
// suite; assertions are sanity-only (results exist, nothing throws) so this
// stays informative, not brittle. Compare the printed table before/after any
// scoring or search change.

import { describe, expect, it } from 'vitest';
import { EVAL_SEEDS, EVAL_SUITE } from '../../test/evalSuite';
import { generate } from './pipeline';

describe('placement quality benchmark', () => {
  it('runs the suite and reports aggregate quality', () => {
    interface Row {
      name: string;
      total: number;
      areaFit: number;
      adjacency: number;
      daylight: number;
      circulation: number;
      wet: number;
      entrance: number;
      errors: number;
      warnings: number;
      variants: number;
    }
    const rows: Row[] = [];

    for (const evalCase of EVAL_SUITE) {
      const acc = { total: 0, areaFit: 0, adjacency: 0, daylight: 0, circulation: 0, wet: 0, entrance: 0 };
      let errors = 0;
      let warnings = 0;
      let variants = 0;
      for (const seed of EVAL_SEEDS) {
        const result = generate({
          program: evalCase.program,
          plot: evalCase.plot,
          seed,
          k: 3,
          budgetMs: 0,
          candidateCount: 32,
          annealIterations: 1_000,
        });
        expect(result.feasibility).not.toBe('blocked');
        const best = result.variants[0];
        if (!best) continue;
        variants += result.variants.length;
        acc.total += best.metrics.totalScore;
        acc.areaFit += best.metrics.areaFitScore;
        acc.adjacency += best.metrics.adjacencyScore;
        acc.daylight += best.metrics.daylightScore;
        acc.circulation += best.metrics.circulationScore ?? 1;
        acc.wet += best.metrics.wetClusterScore ?? 1;
        acc.entrance += best.metrics.entranceScore ?? 1;
        for (const variant of result.variants) {
          errors += variant.violations.filter((v) => v.severity === 'error').length;
          warnings += variant.violations.filter((v) => v.severity === 'warning').length;
        }
      }
      const n = EVAL_SEEDS.length;
      rows.push({
        name: evalCase.name,
        total: acc.total / n,
        areaFit: acc.areaFit / n,
        adjacency: acc.adjacency / n,
        daylight: acc.daylight / n,
        circulation: acc.circulation / n,
        wet: acc.wet / n,
        entrance: acc.entrance / n,
        errors,
        warnings,
        variants,
      });
      expect(variants).toBeGreaterThan(0);
    }

    const pct = (x: number) => `${Math.round(x * 100)}`.padStart(3);
    const fmt = (r: Row, name: string) =>
      `${name.padEnd(32)} total ${pct(r.total)}  area ${pct(r.areaFit)}  adj ${pct(r.adjacency)}  sun ${pct(r.daylight)}  circ ${pct(r.circulation)}  wet ${pct(r.wet)}  ent ${pct(r.entrance)}  err ${String(r.errors).padStart(2)}  warn ${String(r.warnings).padStart(3)}  vars ${r.variants}`;
    const lines = rows.map((r) => fmt(r, r.name));
    const mean = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    lines.push('-'.repeat(130));
    lines.push(
      fmt(
        {
          name: 'MEAN',
          total: mean((r) => r.total),
          areaFit: mean((r) => r.areaFit),
          adjacency: mean((r) => r.adjacency),
          daylight: mean((r) => r.daylight),
          circulation: mean((r) => r.circulation),
          wet: mean((r) => r.wet),
          entrance: mean((r) => r.entrance),
          errors: rows.reduce((s, r) => s + r.errors, 0),
          warnings: rows.reduce((s, r) => s + r.warnings, 0),
          variants: rows.reduce((s, r) => s + r.variants, 0),
        },
        'MEAN',
      ),
    );

    console.log(`\n=== placement benchmark ===\n${lines.join('\n')}\n`);
  }, 120_000);
});
