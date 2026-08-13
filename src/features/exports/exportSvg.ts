import type { RoomSpec } from '../../engine';
import { dateStamp, downloadText, safeFilename } from '../../lib/download';
import { useApp } from '../../state/store';
import { planToSvgDocument } from '../plan-view/planToSvg';

export function exportActiveSvg(): void {
  const state = useApp.getState();
  const plan = state.variants.find((v) => v.id === state.activeVariantId) ?? state.variants[0];
  if (!plan) {
    state.setBanner('Nothing to export yet — generate a layout first.');
    return;
  }
  const specs = new Map<string, RoomSpec>(state.program.rooms.map((r) => [r.id, r]));
  const svg = planToSvgDocument(plan, { specs, unitSystem: state.unitSystem });
  downloadText(
    svg,
    `${safeFilename(state.projectName)}-${dateStamp()}-seed${plan.seed}.svg`,
    'image/svg+xml',
  );
}
