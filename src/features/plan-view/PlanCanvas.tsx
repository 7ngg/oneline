// On-screen plan view: pan/zoom shell around the shared renderer, plus an
// interactive edit overlay — drag interior walls (clamped, revalidated),
// slide doors/windows along their walls, double-click a door to flip its
// swing. Edits commit to the store (one undo step) on pointer-up only.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanModel, RoomSpec, Wall } from '../../engine';
import { flipDoorSwing, lerp, moveWallClamped, slideOpening, mm } from '../../engine';
import { useApp } from '../../state/store';
import { HATCH_DEF, planToSvgInner, planViewBox, viewBoxAttr, type ViewBoxWorld } from './planToSvg';

type DragState =
  | { kind: 'wall'; wallId: string; start: { x: number; y: number }; vertical: boolean }
  | { kind: 'opening'; openingId: string; wallId: string }
  | { kind: 'pan'; x: number; y: number; view: ViewBoxWorld };

export function PlanCanvas() {
  const variants = useApp((s) => s.variants);
  const activeVariantId = useApp((s) => s.activeVariantId);
  const program = useApp((s) => s.program);
  const plot = useApp((s) => s.plot);
  const unitSystem = useApp((s) => s.unitSystem);
  const replaceActiveVariant = useApp((s) => s.replaceActiveVariant);

  const committed = variants.find((v) => v.id === activeVariantId) ?? variants[0] ?? null;
  const [preview, setPreview] = useState<PlanModel | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [view, setView] = useState<ViewBoxWorld | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const lastMoveAt = useRef(0);

  const plan = preview ?? committed;

  const planId = committed?.id ?? null;
  useEffect(() => {
    const current = useApp.getState();
    const p = current.variants.find((x) => x.id === planId) ?? current.variants[0] ?? null;
    if (p) setView(planViewBox(p));
    setPreview(null);
    setDrag(null);
  }, [planId]);

  const inner = useMemo(() => {
    if (!plan) return '';
    const specs = new Map<string, RoomSpec>(program.rooms.map((r) => [r.id, r]));
    const errorRoomIds = new Set(
      plan.violations.filter((v) => v.severity === 'error').flatMap((v) => v.subjects),
    );
    return planToSvgInner(plan, { specs, unitSystem, errorRoomIds });
  }, [plan, program.rooms, unitSystem]);

  if (!plan || !view) {
    return (
      <p className="soft" style={{ margin: 'auto' }}>
        No layout yet — set up rooms and plot, then Generate.
      </p>
    );
  }

  const toWorld = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: -local.y };
  };

  const pxToWorld = (px: number): number => {
    const scale = svgRef.current?.getScreenCTM()?.a ?? 0.05;
    return scale > 0 ? px / scale : px * 20;
  };

  const commitPreview = () => {
    if (preview) replaceActiveVariant(preview);
    setPreview(null);
    setDrag(null);
  };

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const scale = svgRef.current?.getScreenCTM()?.a ?? 0;
      if (scale <= 0) return;
      const dx = (e.clientX - drag.x) / scale;
      const dy = (e.clientY - drag.y) / scale;
      setView({ ...drag.view, minX: drag.view.minX - dx, minY: drag.view.minY + dy });
      return;
    }
    const now = performance.now();
    if (now - lastMoveAt.current < 90) return; // rebuilds are cheap but not free
    lastMoveAt.current = now;
    const p = toWorld(e);
    if (drag.kind === 'wall') {
      const raw = drag.vertical ? p.x - drag.start.x : p.y - drag.start.y;
      const snapped = Math.round(raw / 50) * 50;
      if (snapped === 0) {
        setPreview(null);
        return;
      }
      const next = moveWallClamped(committed as PlanModel, program, plot, drag.wallId, mm(snapped));
      if (next) setPreview(next);
    } else {
      const wall = (committed as PlanModel).walls.find((w) => w.id === drag.wallId);
      if (!wall) return;
      const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
      if (len === 0) return;
      const t =
        ((p.x - wall.a.x) * (wall.b.x - wall.a.x) + (p.y - wall.a.y) * (wall.b.y - wall.a.y)) /
        (len * len);
      const base = preview ?? committed;
      const opening = [...(base as PlanModel).doors, ...(base as PlanModel).windows].find(
        (o) => o.id === drag.openingId,
      );
      if (!opening) return;
      const next = slideOpening(
        committed as PlanModel,
        program,
        plot,
        drag.openingId,
        t - opening.width / len / 2,
      );
      if (next) setPreview(next);
    }
  };

  const wallHitWidth = pxToWorld(9);

  return (
    <svg
      ref={svgRef}
      className="plot-canvas"
      viewBox={viewBoxAttr(view)}
      role="img"
      aria-label={`Floor plan variant, score ${(plan.metrics.totalScore * 100).toFixed(0)}`}
      onWheel={(e) => {
        const p = toWorld(e);
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const w = Math.min(Math.max(view.w * factor, 1_500), 3_000_000);
        const scale = w / view.w;
        setView({
          minX: p.x - (p.x - view.minX) * scale,
          minY: p.y - (p.y - view.minY) * scale,
          w,
          h: view.h * scale,
        });
      }}
      onPointerDown={(e) => {
        if (drag) return;
        setDrag({ kind: 'pan', x: e.clientX, y: e.clientY, view });
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={handleMove}
      onPointerUp={commitPreview}
      onPointerCancel={() => {
        setPreview(null);
        setDrag(null);
      }}
      onDoubleClick={() => setView(planViewBox(plan))}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setPreview(null);
          setDrag(null);
        }
      }}
      tabIndex={0}
    >
      <g dangerouslySetInnerHTML={{ __html: HATCH_DEF + inner }} />

      {/* edit overlay: draggable interior walls */}
      <g>
        {plan.walls
          .filter((w): w is Wall => w.kind === 'interior' && (w.a.x === w.b.x || w.a.y === w.b.y))
          .map((wall) => {
            const vertical = wall.a.x === wall.b.x;
            return (
              <line
                key={wall.id}
                x1={wall.a.x}
                y1={-wall.a.y}
                x2={wall.b.x}
                y2={-wall.b.y}
                stroke="transparent"
                strokeWidth={Math.max(wall.thickness, wallHitWidth)}
                style={{ cursor: vertical ? 'col-resize' : 'row-resize' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const p = toWorld(e);
                  setDrag({ kind: 'wall', wallId: wall.id, start: p, vertical });
                  (e.currentTarget.ownerSVGElement as Element | null)?.setPointerCapture?.(e.pointerId);
                }}
              >
                <title>drag to move wall</title>
              </line>
            );
          })}
        {/* doors & windows: drag to slide, double-click doors to flip swing */}
        {[...plan.doors, ...plan.windows].map((opening) => {
          const wall = plan.walls.find((w) => w.id === opening.wallId);
          if (!wall) return null;
          const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
          if (len === 0) return null;
          const mid = lerp(wall.a, wall.b, opening.t0 + opening.width / len / 2);
          const isDoor = plan.doors.some((d) => d.id === opening.id);
          return (
            <circle
              key={opening.id}
              cx={mid.x}
              cy={-mid.y}
              r={pxToWorld(8)}
              fill="transparent"
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setDrag({ kind: 'opening', openingId: opening.id, wallId: opening.wallId });
                (e.currentTarget.ownerSVGElement as Element | null)?.setPointerCapture?.(e.pointerId);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isDoor) return;
                const flipped = flipDoorSwing(plan, program, plot, opening.id);
                if (flipped) replaceActiveVariant(flipped);
              }}
            >
              <title>{isDoor ? 'drag to slide door; double-click flips swing' : 'drag to slide window'}</title>
            </circle>
          );
        })}
      </g>
    </svg>
  );
}
