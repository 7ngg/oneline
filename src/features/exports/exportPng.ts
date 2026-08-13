// PNG export: shared SVG renderer → blob URL → Image → canvas → toBlob.
// Long side clamped to 8192 px (canvas area caps, notably Safari); toBlob
// failure suggests the SVG export instead of dying silently.

import type { RoomSpec } from '../../engine';
import { dateStamp, downloadBlob, safeFilename } from '../../lib/download';
import { useApp } from '../../state/store';
import { planToSvgDocument, planViewBox } from '../plan-view/planToSvg';

const MAX_SIDE_PX = 8192;
const TARGET_PX_PER_M = 60;

export function exportActivePng(): void {
  const state = useApp.getState();
  const plan = state.variants.find((v) => v.id === state.activeVariantId) ?? state.variants[0];
  if (!plan) {
    state.setBanner('Nothing to export yet — generate a layout first.');
    return;
  }
  const specs = new Map<string, RoomSpec>(state.program.rooms.map((r) => [r.id, r]));
  const svg = planToSvgDocument(plan, { specs, unitSystem: state.unitSystem });
  const vb = planViewBox(plan);

  let widthPx = Math.round((vb.w / 1000) * TARGET_PX_PER_M);
  let heightPx = Math.round((vb.h / 1000) * TARGET_PX_PER_M);
  const longSide = Math.max(widthPx, heightPx);
  if (longSide > MAX_SIDE_PX) {
    const k = MAX_SIDE_PX / longSide;
    widthPx = Math.round(widthPx * k);
    heightPx = Math.round(heightPx * k);
    state.setBanner('Large plan — PNG resolution was capped at 8192 px on the long side.');
  }

  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      state.setBanner('PNG export failed (no canvas context) — use the SVG export instead.');
      return;
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, widthPx, heightPx);
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
    canvas.toBlob((blob) => {
      if (!blob) {
        state.setBanner('PNG export failed — this plan may be too large; use the SVG export instead.');
        return;
      }
      downloadBlob(blob, `${safeFilename(state.projectName)}-${dateStamp()}-seed${plan.seed}.png`);
    }, 'image/png');
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    state.setBanner('PNG export failed to rasterize — use the SVG export instead.');
  };
  img.src = url;
}
