// Interactive plot boundary editor. World units are mm with +Y = north; the
// SVG renders with y negated (sy). Drawing rules:
// - click places snapped vertices; click near the first vertex (or
//   double-click / Enter with ≥3 points) closes the ring
// - closed boundary: drag vertices, click an edge midpoint to insert one,
//   select + Delete removes one
// - self-intersections are highlighted live and disable generation upstream
// - the dashed inner outline previews the footprint after setbacks

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Plot, Ring, Vec, Violation } from '../../engine';
import {
  computeFootprint,
  dist,
  lerp,
  mm,
  ringBbox,
  selfIntersections,
  v,
  validatePlot,
} from '../../engine';
import { LengthField } from '../program-form/fields';
import { useApp } from '../../state/store';

const SNAP = mm(250);
const CLOSE_HIT_PX = 12;

const snap = (value: number): number => Math.round(value / SNAP) * SNAP;

interface ViewBox {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

const fitView = (ring: Ring): ViewBox => {
  if (ring.length === 0) return { minX: -2_000, minY: -2_000, w: 20_000, h: 16_000 };
  const bb = ringBbox(ring);
  const margin = Math.max(2_000, (bb.maxX - bb.minX) * 0.15, (bb.maxY - bb.minY) * 0.15);
  return {
    minX: bb.minX - margin,
    minY: bb.minY - margin,
    w: bb.maxX - bb.minX + margin * 2,
    h: bb.maxY - bb.minY + margin * 2,
  };
};

export function PlotEditor() {
  const plot = useApp((s) => s.plot);
  const setPlot = useApp((s) => s.setPlot);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewBox>(() => fitView(plot.boundary));
  const [draft, setDraft] = useState<Ring>([]);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [entranceMode, setEntranceMode] = useState(false);
  const [panning, setPanning] = useState<{ x: number; y: number; view: ViewBox } | null>(null);

  const closed = plot.boundary.length >= 3;
  const drawing = !closed;
  const ring = drawing ? draft : plot.boundary;

  const violations = useMemo(() => (closed ? validatePlot(plot) : []), [closed, plot]);
  const badEdges = useMemo(() => {
    const set = new Set<number>();
    for (const [i, j] of selfIntersections(ring)) {
      set.add(i);
      set.add(j);
    }
    return set;
  }, [ring]);
  const footprint = useMemo(() => {
    if (!closed || violations.some((x) => x.severity === 'error')) return null;
    return computeFootprint(plot).footprint;
  }, [closed, plot, violations]);

  useEffect(() => {
    if (closed) setView(fitView(plot.boundary));
    // refit only when the boundary itself changes shape
  }, [closed, plot.boundary]);

  const updateBoundary = (boundary: Ring) => {
    // entrance indexes edges; any boundary change invalidates it
    const { entrance: _dropped, ...rest } = plot;
    setPlot({ ...rest, boundary });
  };

  // Screen→world through the SVG's own CTM: handles preserveAspectRatio
  // letterboxing exactly (naive rect math lands clicks off-target).
  const toWorld = (e: { clientX: number; clientY: number }): Vec => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return v(0, 0);
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return v(local.x, -local.y);
  };

  const pxToWorld = (px: number): number => {
    const scale = svgRef.current?.getScreenCTM()?.a ?? 0.05;
    return scale > 0 ? px / scale : px * 20;
  };

  const sy = (y: number): number => -y;

  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || e.shiftKey) {
      setPanning({ x: e.clientX, y: e.clientY, view });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (entranceMode && closed) {
      placeEntrance(toWorld(e));
      return;
    }
    if (!drawing) {
      setSelectedIdx(null);
      return;
    }
    const p = toWorld(e);
    const snapped = v(snap(p.x), snap(p.y));
    if (draft.length >= 3) {
      const first = draft[0] as Vec;
      if (dist(first, p) < pxToWorld(CLOSE_HIT_PX)) {
        updateBoundary(draft);
        setDraft([]);
        return;
      }
    }
    setDraft([...draft, snapped]);
  };

  const placeEntrance = (p: Vec) => {
    let best: { edgeIndex: number; t: number; d: number } | null = null;
    for (let i = 0; i < plot.boundary.length; i++) {
      const a = plot.boundary[i] as Vec;
      const b = plot.boundary[(i + 1) % plot.boundary.length] as Vec;
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      if (len2 === 0) continue;
      const t = Math.max(0.05, Math.min(0.95, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
      const proj = lerp(a, b, t);
      const d = dist(p, proj);
      if (!best || d < best.d) best = { edgeIndex: i, t, d };
    }
    if (best) {
      setPlot({ ...plot, entrance: { edgeIndex: best.edgeIndex, t: best.t } });
      setEntranceMode(false);
    }
  };

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (panning) {
      const scale = svgRef.current?.getScreenCTM()?.a ?? 0;
      if (scale > 0) {
        const dx = (e.clientX - panning.x) / scale;
        const dy = (e.clientY - panning.y) / scale;
        setView({ ...panning.view, minX: panning.view.minX - dx, minY: panning.view.minY + dy });
      }
      return;
    }
    const p = toWorld(e);
    setCursor(p);
    if (dragIdx !== null && closed) {
      const snapped = v(snap(p.x), snap(p.y));
      updateBoundary(plot.boundary.map((q, i) => (i === dragIdx ? snapped : q)));
    }
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const p = toWorld(e);
    const w = Math.min(Math.max(view.w * factor, 2_000), 3_000_000);
    const scale = w / view.w;
    setView({
      minX: p.x - (p.x - view.minX) * scale,
      minY: p.y - (p.y - view.minY) * scale,
      w,
      h: view.h * scale,
    });
  };

  const insertVertexOnEdge = (edgeIndex: number) => {
    const a = plot.boundary[edgeIndex] as Vec;
    const b = plot.boundary[(edgeIndex + 1) % plot.boundary.length] as Vec;
    const mid = v(snap((a.x + b.x) / 2), snap((a.y + b.y) / 2));
    const next = [...plot.boundary];
    next.splice(edgeIndex + 1, 0, mid);
    updateBoundary(next);
  };

  const deleteSelected = () => {
    if (selectedIdx === null || plot.boundary.length <= 3) return;
    updateBoundary(plot.boundary.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  };

  const makeRectangle = (w: number, d: number) => {
    updateBoundary([v(0, 0), v(w, 0), v(w, d), v(0, d)]);
    setDraft([]);
  };

  const viewBoxAttr = `${view.minX} ${-(view.minY + view.h)} ${view.w} ${view.h}`;
  const strokeW = pxToWorld(1.5);

  return (
    <div className="plot-editor">
      <div className="canvas-toolbar row wrap">
        {closed ? (
          <>
            <button onClick={() => updateBoundary([])}>Redraw boundary</button>
            <button aria-pressed={entranceMode} onClick={() => setEntranceMode(!entranceMode)}>
              {entranceMode ? 'Click an edge…' : plot.entrance ? 'Move entrance' : 'Set entrance'}
            </button>
            <button disabled={selectedIdx === null || plot.boundary.length <= 3} onClick={deleteSelected}>
              Delete corner
            </button>
            <LengthField
              label="setback"
              value={'uniform' in plot.setback ? plot.setback.uniform : mm(0)}
              onCommit={(value) => setPlot({ ...plot, setback: { uniform: value } })}
              width={70}
            />
          </>
        ) : (
          <>
            <span className="soft">Click to place corners; click the first corner to close.</span>
            {draft.length >= 3 && (
              <button
                onClick={() => {
                  updateBoundary(draft);
                  setDraft([]);
                }}
              >
                Close shape
              </button>
            )}
            {draft.length > 0 && <button onClick={() => setDraft([])}>Clear</button>}
            <QuickRect onMake={makeRectangle} />
          </>
        )}
      </div>

      <svg
        ref={svgRef}
        className="plot-canvas"
        viewBox={viewBoxAttr}
        role="img"
        aria-label="Plot drawing canvas"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleMove}
        onPointerUp={() => {
          setDragIdx(null);
          setPanning(null);
        }}
        onWheel={handleWheel}
        onDoubleClick={() => {
          if (drawing && draft.length >= 3) {
            updateBoundary(draft);
            setDraft([]);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
          if (e.key === 'Enter' && drawing && draft.length >= 3) {
            updateBoundary(draft);
            setDraft([]);
          }
          if (e.key === 'Escape') {
            setSelectedIdx(null);
            setEntranceMode(false);
          }
        }}
        tabIndex={0}
      >
        <Grid view={view} />

        {footprint && (
          <polygon
            points={footprint.outer.map((p) => `${p.x},${sy(p.y)}`).join(' ')}
            fill="var(--accent-soft)"
            stroke="var(--accent)"
            strokeWidth={strokeW}
            strokeDasharray={`${strokeW * 4} ${strokeW * 3}`}
          />
        )}

        {ring.length > 0 && (
          <>
            {ring.map((a, i) => {
              const b = ring[(i + 1) % ring.length] as Vec;
              if (drawing && i === ring.length - 1) return null;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={sy(a.y)}
                  x2={b.x}
                  y2={sy(b.y)}
                  stroke={badEdges.has(i) ? 'var(--error)' : 'var(--ink)'}
                  strokeWidth={badEdges.has(i) ? strokeW * 2 : strokeW}
                  {...(closed && !entranceMode
                    ? {
                        onDoubleClick: (e: React.MouseEvent) => {
                          e.stopPropagation();
                          insertVertexOnEdge(i);
                        },
                        style: { cursor: 'copy' },
                      }
                    : {})}
                />
              );
            })}
            {drawing && cursor && ring.length > 0 && (
              <line
                x1={(ring[ring.length - 1] as Vec).x}
                y1={sy((ring[ring.length - 1] as Vec).y)}
                x2={cursor.x}
                y2={sy(cursor.y)}
                stroke="var(--ink-soft)"
                strokeWidth={strokeW}
                strokeDasharray={`${strokeW * 3} ${strokeW * 3}`}
              />
            )}
            {ring.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={sy(p.y)}
                r={pxToWorld(i === 0 && drawing && draft.length >= 3 ? 7 : 4.5)}
                fill={selectedIdx === i ? 'var(--accent)' : '#fff'}
                stroke={i === 0 && drawing ? 'var(--accent)' : 'var(--ink)'}
                strokeWidth={strokeW}
                style={{ cursor: closed ? 'grab' : 'pointer' }}
                onPointerDown={(e) => {
                  if (!closed) return;
                  e.stopPropagation();
                  setSelectedIdx(i);
                  setDragIdx(i);
                }}
              />
            ))}
          </>
        )}

        {plot.entrance && closed && <EntranceMarker plot={plot} sy={sy} size={pxToWorld(10)} />}
        <NorthArrow view={view} northDeg={plot.northDeg} pxToWorld={pxToWorld} />
      </svg>

      {/* footer is ALWAYS rendered with a stable min-height: if it appeared on
          first click it would resize the canvas mid-draw and shift the
          screen→world mapping under the user's cursor */}
      <div className="canvas-footer">
        {violations.map((x: Violation, i) => (
          <p key={i} className={`inline-violation ${x.severity}`}>
            {x.message}
          </p>
        ))}
        {!closed && (
          <p className="soft">
            {draft.length === 0
              ? 'Click in the canvas to place the first corner.'
              : `${draft.length} corner${draft.length === 1 ? '' : 's'} placed`}
          </p>
        )}
        {closed && violations.length === 0 && <p className="soft">Plot ready.</p>}
      </div>
    </div>
  );
}

function QuickRect({ onMake }: { onMake: (w: number, d: number) => void }) {
  const [w, setW] = useState(mm(12_000));
  const [d, setD] = useState(mm(9_000));
  return (
    <span className="row" style={{ gap: 4 }}>
      <LengthField label="w" value={w} onCommit={setW} width={58} ariaLabel="Rectangle width" />
      <LengthField label="d" value={d} onCommit={setD} width={58} ariaLabel="Rectangle depth" />
      <button onClick={() => onMake(w, d)}>Rectangle</button>
    </span>
  );
}

function EntranceMarker({ plot, sy, size }: { plot: Plot; sy: (y: number) => number; size: number }) {
  const entrance = plot.entrance;
  if (!entrance) return null;
  const a = plot.boundary[entrance.edgeIndex];
  const b = plot.boundary[(entrance.edgeIndex + 1) % plot.boundary.length];
  if (!a || !b) return null;
  const p = lerp(a, b, entrance.t);
  return (
    <g>
      <circle cx={p.x} cy={sy(p.y)} r={size * 0.8} fill="var(--ok)" opacity={0.9} />
      <text x={p.x} y={sy(p.y)} fontSize={size} textAnchor="middle" dominantBaseline="central" fill="#fff">
        E
      </text>
    </g>
  );
}

function NorthArrow({
  view,
  northDeg,
  pxToWorld,
}: {
  view: ViewBox;
  northDeg: number;
  pxToWorld: (px: number) => number;
}) {
  const cx = view.minX + pxToWorld(28);
  const cy = -(view.minY + view.h) + pxToWorld(28);
  const r = pxToWorld(16);
  return (
    <g transform={`rotate(${northDeg} ${cx} ${cy})`} aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke="var(--line)" strokeWidth={pxToWorld(1)} />
      <path
        d={`M ${cx} ${cy - r * 0.7} L ${cx - r * 0.35} ${cy + r * 0.45} L ${cx + r * 0.35} ${cy + r * 0.45} Z`}
        fill="var(--error)"
      />
      <text x={cx} y={cy - r - pxToWorld(4)} fontSize={pxToWorld(10)} textAnchor="middle" fill="var(--ink-soft)">
        N
      </text>
    </g>
  );
}

function Grid({ view }: { view: ViewBox }) {
  // metre grid, thinned as you zoom out
  const step = view.w > 120_000 ? 10_000 : view.w > 40_000 ? 5_000 : 1_000;
  const lines: React.ReactNode[] = [];
  const x0 = Math.floor(view.minX / step) * step;
  const y0 = Math.floor(view.minY / step) * step;
  for (let x = x0; x <= view.minX + view.w; x += step) {
    lines.push(
      <line
        key={`vx${x}`}
        x1={x}
        y1={-(view.minY + view.h)}
        x2={x}
        y2={-view.minY}
        stroke="var(--line)"
        strokeWidth={view.w / 900}
      />,
    );
  }
  for (let y = y0; y <= view.minY + view.h; y += step) {
    lines.push(
      <line
        key={`hy${y}`}
        x1={view.minX}
        y1={-y}
        x2={view.minX + view.w}
        y2={-y}
        stroke="var(--line)"
        strokeWidth={view.w / 900}
      />,
    );
  }
  return <g aria-hidden>{lines}</g>;
}
