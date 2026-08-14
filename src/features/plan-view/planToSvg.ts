// THE plan renderer. Pure string builder used by the on-screen canvas
// (embedded as inner SVG), thumbnails, SVG export, PNG rasterization, and PDF
// vectorization — one renderer, zero drift between screen and exports.
// World is Y-up; rendering negates y.

import type { PlanModel, RoomSpec, RoomType, Vec, Wall } from '../../engine';
import { lerp, ringBbox } from '../../engine';
import { formatArea } from '../../lib/format';
import type { UnitSystem } from '../../state/store';

export const ROOM_FILL: Record<RoomType, string> = {
  living: '#f7e3c2',
  bedroom: '#cfe0f5',
  kitchen: '#f8d8cf',
  bathroom: '#d3eede',
  wc: '#d3eede',
  hall: '#eee9df',
  storage: '#e4e0f2',
  balcony: '#dcf0f6',
  other: '#e9e9e9',
};

export interface PlanRenderOptions {
  specs: Map<string, RoomSpec>;
  unitSystem: UnitSystem;
  showLabels?: boolean;
  /** Room ids (plan-room ids) with error-severity violations → red hatch. */
  errorRoomIds?: Set<string>;
}

export interface ViewBoxWorld {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function planViewBox(plan: PlanModel, marginRatio = 0.06): ViewBoxWorld {
  const bb = ringBbox(plan.footprint.outer);
  const margin = Math.max(600, (bb.maxX - bb.minX) * marginRatio, (bb.maxY - bb.minY) * marginRatio);
  return {
    minX: bb.minX - margin,
    minY: bb.minY - margin,
    w: bb.maxX - bb.minX + margin * 2,
    h: bb.maxY - bb.minY + margin * 2,
  };
}

export const viewBoxAttr = (v: ViewBoxWorld): string => `${v.minX} ${-(v.minY + v.h)} ${v.w} ${v.h}`;

const polyPath = (outer: Vec[], holes: Vec[][]): string => {
  const ringPath = (r: Vec[]): string =>
    r.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${-p.y}`).join('') + 'Z';
  return ringPath(outer) + holes.map(ringPath).join('');
};

/** Inner SVG markup (no <svg> wrapper) for a plan. */
export function planToSvgInner(plan: PlanModel, opts: PlanRenderOptions): string {
  const parts: string[] = [];
  const scaleRef = Math.max(planViewBox(plan).w, planViewBox(plan).h);
  const thin = Math.max(10, scaleRef / 700);

  // rooms
  for (const room of plan.rooms) {
    const spec = opts.specs.get(room.specId);
    const fill = ROOM_FILL[spec?.type ?? 'other'];
    const isError = opts.errorRoomIds?.has(room.id) ?? false;
    parts.push(
      `<path d="${polyPath(room.poly.outer, room.poly.holes)}" fill="${fill}" stroke="${
        isError ? '#d23b3b' : '#3c4657'
      }" stroke-width="${isError ? thin * 2 : thin}" fill-rule="evenodd"/>`,
    );
    if (isError) {
      parts.push(
        `<path d="${polyPath(room.poly.outer, room.poly.holes)}" fill="url(#errhatch)" stroke="none" fill-rule="evenodd"/>`,
      );
    }
  }

  // walls (present after the openings stage)
  for (const wall of plan.walls) {
    parts.push(
      `<line x1="${wall.a.x}" y1="${-wall.a.y}" x2="${wall.b.x}" y2="${-wall.b.y}" stroke="#28303d" stroke-width="${wall.thickness}" stroke-linecap="butt"/>`,
    );
  }

  // door + window openings drawn over walls
  const wallById = new Map<string, Wall>(plan.walls.map((w) => [w.id, w]));
  for (const door of plan.doors) {
    const wall = wallById.get(door.wallId);
    if (!wall) continue;
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    if (len === 0) continue;
    const t1 = door.t0 + door.width / len;
    const p0 = lerp(wall.a, wall.b, door.t0);
    const p1 = lerp(wall.a, wall.b, Math.min(1, t1));
    parts.push(
      `<line x1="${p0.x}" y1="${-p0.y}" x2="${p1.x}" y2="${-p1.y}" stroke="#ffffff" stroke-width="${
        wall.thickness + 2
      }" stroke-linecap="butt"/>`,
    );
    const kind = door.kind ?? 'door';
    if (kind === 'open') {
      // doorless opening (CT01 notation: dashed line) — the wall just stops
      parts.push(
        `<line x1="${p0.x}" y1="${-p0.y}" x2="${p1.x}" y2="${-p1.y}" stroke="#8a93a3" stroke-width="${thin}" stroke-dasharray="${thin * 4} ${thin * 3}"/>`,
      );
      continue;
    }
    const dx = (p1.x - p0.x) / (door.width || 1);
    const dy = (p1.y - p0.y) / (door.width || 1);
    if (kind === 'sliding') {
      // sliding glass partition (CT01: dashed blue) — two offset half-leaves
      const ox = -dy * (wall.thickness / 2 + thin);
      const oy = dx * (wall.thickness / 2 + thin);
      const aX = p0.x + (p1.x - p0.x) * 0.6;
      const aY = p0.y + (p1.y - p0.y) * 0.6;
      const bX = p0.x + (p1.x - p0.x) * 0.4;
      const bY = p0.y + (p1.y - p0.y) * 0.4;
      parts.push(
        `<line x1="${p0.x + ox}" y1="${-(p0.y + oy)}" x2="${aX + ox}" y2="${-(aY + oy)}" stroke="#4d8fd6" stroke-width="${thin * 1.5}" stroke-dasharray="${thin * 5} ${thin * 3}"/>`,
        `<line x1="${bX - ox}" y1="${-(bY - oy)}" x2="${p1.x - ox}" y2="${-(p1.y - oy)}" stroke="#4d8fd6" stroke-width="${thin * 1.5}" stroke-dasharray="${thin * 5} ${thin * 3}"/>`,
      );
      continue;
    }
    // Hinged door symbol: leaf line perpendicular to the wall at the hinge
    // end (t0 end by default, the far end when door.hinge === 'b' — Do01
    // puts the hinge by the corner) plus a quarter-circle swing arc from the
    // free jamb to the leaf tip. door.swing = which SIDE of the wall it
    // opens into: 'left' = left of the wall's a→b direction (world, Y-up).
    const hingeAtB = door.hinge === 'b';
    const hingeP = hingeAtB ? p1 : p0;
    const freeP = hingeAtB ? p0 : p1;
    // world perpendicular toward the chosen side
    const nx = door.swing === 'left' ? -dy : dy;
    const ny = door.swing === 'left' ? dx : -dx;
    const leafX = hingeP.x + nx * door.width;
    const leafY = hingeP.y + ny * door.width;
    // arc direction around the hinge: side 'left' with the hinge at t0 is
    // CCW in world = sweep 1 on the Y-flipped screen; mirroring either the
    // side or the hinge end flips it
    const sweep = (door.swing === 'left') === !hingeAtB ? 1 : 0;
    parts.push(
      `<path d="M${freeP.x} ${-freeP.y} A${door.width} ${door.width} 0 0 ${sweep} ${leafX} ${-leafY}" fill="none" stroke="#8a93a3" stroke-width="${thin}"/>`,
      `<line x1="${hingeP.x}" y1="${-hingeP.y}" x2="${leafX}" y2="${-leafY}" stroke="#8a93a3" stroke-width="${thin}"/>`,
    );
  }
  for (const win of plan.windows) {
    const wall = wallById.get(win.wallId);
    if (!wall) continue;
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    if (len === 0) continue;
    const p0 = lerp(wall.a, wall.b, win.t0);
    const p1 = lerp(wall.a, wall.b, Math.min(1, win.t0 + win.width / len));
    parts.push(
      `<line x1="${p0.x}" y1="${-p0.y}" x2="${p1.x}" y2="${-p1.y}" stroke="#ffffff" stroke-width="${wall.thickness}" stroke-linecap="butt"/>`,
      `<line x1="${p0.x}" y1="${-p0.y}" x2="${p1.x}" y2="${-p1.y}" stroke="#4d8fd6" stroke-width="${thin * 2}" stroke-linecap="butt"/>`,
    );
  }

  // labels
  if (opts.showLabels !== false) {
    const fontSize = Math.max(220, scaleRef / 34);
    for (const room of plan.rooms) {
      const spec = opts.specs.get(room.specId);
      const bb = ringBbox(room.poly.outer);
      const cx = (bb.minX + bb.maxX) / 2;
      const cy = (bb.minY + bb.maxY) / 2;
      parts.push(
        `<text x="${cx}" y="${-cy}" font-size="${fontSize}" text-anchor="middle" fill="#39424f" font-family="'Segoe UI', system-ui, sans-serif"><tspan x="${cx}" dy="-0.15em">${esc(
          spec?.name ?? '',
        )}</tspan><tspan x="${cx}" dy="1.1em" fill="#707a88" font-size="${fontSize * 0.82}">${esc(
          formatArea(room.grossArea, opts.unitSystem),
        )}</tspan></text>`,
      );
    }
  }

  return parts.join('\n');
}

const HATCH_DEF = `<defs><pattern id="errhatch" width="400" height="400" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="400" stroke="#d23b3b" stroke-width="60" opacity="0.25"/></pattern></defs>`;

/** Standalone SVG document — exports and thumbnails. */
export function planToSvgDocument(plan: PlanModel, opts: PlanRenderOptions): string {
  const vb = planViewBox(plan);
  const disclaimer = 'Concept design only — not construction documentation; not checked against building codes.';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxAttr(vb)}">`,
    `<desc>${esc(disclaimer)} Seed ${plan.seed}.</desc>`,
    HATCH_DEF,
    `<rect x="${vb.minX}" y="${-(vb.minY + vb.h)}" width="${vb.w}" height="${vb.h}" fill="#ffffff"/>`,
    planToSvgInner(plan, opts),
    `</svg>`,
  ].join('\n');
}

export { HATCH_DEF };
