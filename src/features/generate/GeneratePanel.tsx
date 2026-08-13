// Generate tab: seed control, run/cancel, progress, and the relaxation
// dialog for infeasible programs (ranked one-click fixes).

import { useState } from 'react';
import type { GenerateResult, Violation } from '../../engine';
import { validatePlot, validateProgram } from '../../engine';
import { applyRelaxation } from '../../lib/relaxation';
import { useApp } from '../../state/store';
import { solverClient } from '../../worker/client';

const K = 6;
const BUDGET_MS = 8_000;

export function GeneratePanel() {
  const program = useApp((s) => s.program);
  const plot = useApp((s) => s.plot);
  const solver = useApp((s) => s.solver);
  const setSolver = useApp((s) => s.setSolver);
  const setVariants = useApp((s) => s.setVariants);
  const generation = useApp((s) => s.generation);
  const [seedText, setSeedText] = useState(() => String(generation?.seed ?? 42));
  const [showRelaxations, setShowRelaxations] = useState(false);

  const inputErrors = [...validateProgram(program), ...validatePlot(plot)].filter(
    (v) => v.severity === 'error',
  );
  const canGenerate = inputErrors.length === 0 && !solver.running;

  const run = async (seed: number) => {
    setSolver({ running: true, progress: 0, stage: 'starting', violations: [], feasibility: null });
    setShowRelaxations(false);
    try {
      const result: GenerateResult = await solverClient.run(
        { program, plot, seed, k: K, budgetMs: BUDGET_MS },
        (p) =>
          setSolver({
            progress: p.total > 0 ? p.done / p.total : 0,
            stage: p.stage,
          }),
      );
      setSolver({ running: false, violations: result.violations, feasibility: result.feasibility });
      if (result.variants.length > 0) {
        setVariants(result.variants, { seed, k: K, budgetMs: BUDGET_MS });
      }
      if (result.feasibility === 'infeasible') setShowRelaxations(true);
    } catch (err) {
      setSolver({ running: false });
      useApp
        .getState()
        .setBanner(
          `Generation failed unexpectedly (${err instanceof Error ? err.message : String(err)}). Seed ${seed} — please retry.`,
        );
    }
  };

  const parsedSeed = Number.parseInt(seedText, 10);
  const seedValid = Number.isInteger(parsedSeed);

  return (
    <div className="stack">
      <div className="row">
        <label className="field">
          <span className="field-label">seed</span>
          <input
            aria-label="Random seed"
            style={{ width: 90 }}
            value={seedText}
            aria-invalid={seedValid ? undefined : 'true'}
            onChange={(e) => setSeedText(e.target.value)}
          />
        </label>
        <button
          aria-label="Random seed"
          onClick={() => setSeedText(String(Math.floor(Math.random() * 100_000)))}
        >
          🎲
        </button>
      </div>

      {solver.running ? (
        <div className="stack">
          <progress value={solver.progress} max={1} style={{ width: '100%' }} />
          <div className="row">
            <span className="soft">{solver.stage}…</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => solverClient.cancel()}>Cancel (keep best so far)</button>
          </div>
        </div>
      ) : (
        <button className="primary" disabled={!canGenerate || !seedValid} onClick={() => void run(parsedSeed)}>
          Generate {K} layouts
        </button>
      )}

      {inputErrors.length > 0 && (
        <div className="stack">
          <p className="soft">Fix these before generating:</p>
          {inputErrors.map((v, i) => (
            <p key={i} className="inline-violation error">
              {v.message}
            </p>
          ))}
        </div>
      )}

      {generation && !solver.running && (
        <p className="soft">
          Last run: seed {generation.seed}. Re-running with the same seed reproduces identical layouts.
        </p>
      )}

      {showRelaxations && <RelaxationList violations={solver.violations} onApplied={(seed) => void run(seed)} />}

      {!showRelaxations &&
        solver.violations
          .filter((v) => v.severity !== 'error')
          .map((v, i) => (
            <p key={i} className={`inline-violation ${v.severity}`}>
              {v.message}
            </p>
          ))}
    </div>
  );
}

function RelaxationList({
  violations,
  onApplied,
}: {
  violations: Violation[];
  onApplied: (seed: number) => void;
}) {
  const program = useApp((s) => s.program);
  const plot = useApp((s) => s.plot);
  const setProgram = useApp((s) => s.setProgram);
  const setPlot = useApp((s) => s.setPlot);
  const generation = useApp((s) => s.generation);

  const fixable = violations.filter((v) => v.fix);

  return (
    <div className="stack relaxations" role="region" aria-label="Suggested fixes">
      <strong>This program doesn't fit. Suggested fixes:</strong>
      {violations
        .filter((v) => v.severity === 'error')
        .map((v, i) => (
          <p key={i} className="inline-violation error">
            {v.message}
          </p>
        ))}
      {fixable.map((v, i) => (
        <button
          key={i}
          onClick={() => {
            const fix = v.fix;
            if (!fix) return;
            const next = applyRelaxation(program, plot, fix.relaxation);
            setProgram(next.program);
            setPlot(next.plot);
            onApplied(generation?.seed ?? 42);
          }}
        >
          {v.fix?.label}
        </button>
      ))}
      {fixable.length === 0 && <p className="soft">Adjust room sizes or the plot manually.</p>}
    </div>
  );
}
