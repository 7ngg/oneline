// DXF export. Layered (ROOMS/WALLS/DOORS/WINDOWS/TEXT/NOTES), $INSUNITS=4
// (millimetres), raw integer mm coordinates, Y-up — DXF's native orientation,
// so no flip. ASCII layer names; room labels go into TEXT entities.

import { DxfWriter, point2d, point3d, LWPolylineFlags, Units } from '@tarikjabiri/dxf';
import type { PlanModel, RoomSpec } from '../../engine';
import { lerp, ringBbox } from '../../engine';
import { dateStamp, downloadText, safeFilename } from '../../lib/download';
import { useApp } from '../../state/store';

const DISCLAIMER = 'NOT FOR CONSTRUCTION - CONCEPT DESIGN ONLY - NOT CODE CHECKED';

export function planToDxfString(plan: PlanModel, specs: Map<string, RoomSpec>): string {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Millimeters);
  dxf.setVariable('$MEASUREMENT', { 70: 1 });

  dxf.addLayer('ROOMS', 8, 'Continuous');
  dxf.addLayer('WALLS', 7, 'Continuous');
  dxf.addLayer('DOORS', 1, 'Continuous');
  dxf.addLayer('WINDOWS', 5, 'Continuous');
  dxf.addLayer('TEXT', 7, 'Continuous');
  dxf.addLayer('NOTES', 1, 'Continuous');

  for (const room of plan.rooms) {
    const outer = room.poly.outer.map((p) => ({ point: point2d(p.x, p.y) }));
    dxf.addLWPolyline(outer, { layerName: 'ROOMS', flags: LWPolylineFlags.Closed });
    for (const hole of room.poly.holes) {
      dxf.addLWPolyline(
        hole.map((p) => ({ point: point2d(p.x, p.y) })),
        { layerName: 'ROOMS', flags: LWPolylineFlags.Closed },
      );
    }
    const spec = specs.get(room.specId);
    const bb = ringBbox(room.poly.outer);
    const label = asciiSafe(spec?.name ?? 'Room');
    const area = `${(room.grossArea / 1e6).toFixed(1)} m2`;
    dxf.addText(point3d((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, 0), 300, label, {
      layerName: 'TEXT',
    });
    dxf.addText(point3d((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2 - 400, 0), 220, area, {
      layerName: 'TEXT',
    });
  }

  for (const wall of plan.walls) {
    dxf.addLWPolyline(
      [{ point: point2d(wall.a.x, wall.a.y) }, { point: point2d(wall.b.x, wall.b.y) }],
      { layerName: 'WALLS', constantWidth: wall.thickness },
    );
  }

  const wallById = new Map(plan.walls.map((w) => [w.id, w]));
  const openingLine = (o: { wallId: string; t0: number; width: number }, layer: string) => {
    const wall = wallById.get(o.wallId);
    if (!wall) return;
    const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
    if (len === 0) return;
    const p0 = lerp(wall.a, wall.b, o.t0);
    const p1 = lerp(wall.a, wall.b, Math.min(1, o.t0 + o.width / len));
    dxf.addLine(point3d(p0.x, p0.y, 0), point3d(p1.x, p1.y, 0), { layerName: layer });
  };
  for (const door of plan.doors) openingLine(door, 'DOORS');
  for (const win of plan.windows) openingLine(win, 'WINDOWS');

  const bb = ringBbox(plan.footprint.outer);
  dxf.addText(point3d(bb.minX, bb.minY - 1200, 0), 350, DISCLAIMER, { layerName: 'NOTES' });
  dxf.addText(point3d(bb.minX, bb.minY - 1800, 0), 250, `Seed ${plan.seed} - oneline concept plan`, {
    layerName: 'NOTES',
  });

  return dxf.stringify();
}

const asciiSafe = (s: string): string => s.replace(/[^\x20-\x7e]/g, '?');

export function exportActiveDxf(): void {
  const state = useApp.getState();
  const plan = state.variants.find((v) => v.id === state.activeVariantId) ?? state.variants[0];
  if (!plan) {
    state.setBanner('Nothing to export yet — generate a layout first.');
    return;
  }
  const specs = new Map<string, RoomSpec>(state.program.rooms.map((r) => [r.id, r]));
  downloadText(
    planToDxfString(plan, specs),
    `${safeFilename(state.projectName)}-${dateStamp()}-seed${plan.seed}.dxf`,
    'application/dxf',
  );
}
