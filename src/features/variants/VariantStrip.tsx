import { useMemo } from 'react';
import type { RoomSpec } from '../../engine';
import { useApp } from '../../state/store';
import { planToSvgDocument } from '../plan-view/planToSvg';

export function VariantStrip() {
  const variants = useApp((s) => s.variants);
  const activeVariantId = useApp((s) => s.activeVariantId);
  const setActiveVariant = useApp((s) => s.setActiveVariant);
  const program = useApp((s) => s.program);
  const unitSystem = useApp((s) => s.unitSystem);

  const specs = useMemo(
    () => new Map<string, RoomSpec>(program.rooms.map((r) => [r.id, r])),
    [program.rooms],
  );

  if (variants.length === 0) return null;

  return (
    <div className="variant-strip" role="listbox" aria-label="Layout variants">
      {variants.map((variant, i) => {
        const errors = variant.violations.filter((v) => v.severity === 'error').length;
        const svg = planToSvgDocument(variant, { specs, unitSystem, showLabels: false });
        return (
          <button
            key={variant.id}
            role="option"
            aria-selected={variant.id === activeVariantId}
            className={`variant-thumb ${variant.id === activeVariantId ? 'active' : ''}`}
            onClick={() => setActiveVariant(variant.id)}
            title={`Variant ${i + 1} — score ${(variant.metrics.totalScore * 100).toFixed(0)}${
              errors ? `, ${errors} problem${errors > 1 ? 's' : ''}` : ''
            }`}
          >
            <span
              className="variant-thumb-img"
              dangerouslySetInnerHTML={{ __html: svg }}
              aria-hidden
            />
            <span className="variant-meta">
              <span>#{i + 1}</span>
              <span>{(variant.metrics.totalScore * 100).toFixed(0)}</span>
              {errors > 0 && <span className="variant-errors">{errors}⚠</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
