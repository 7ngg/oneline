// Vector PDF export via jspdf + svg2pdf, from the shared SVG renderer.
// Paper A4/A3/Letter; scale "fit" or fixed 1:50/1:100/1:200 — a fixed scale
// that overflows the paper is rejected with the next workable suggestion.
// Footer carries scale, seed, date, and the disclaimer.

import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import type { RoomSpec } from '../../engine';
import { dateStamp, safeFilename } from '../../lib/download';
import { useApp } from '../../state/store';
import { planToSvgDocument, planViewBox } from '../plan-view/planToSvg';

export type PaperName = 'a4' | 'a3' | 'letter';
export type ScaleChoice = 'fit' | 50 | 100 | 200;

const PAPER_MM: Record<PaperName, [number, number]> = {
  a4: [297, 210], // landscape
  a3: [420, 297],
  letter: [279.4, 215.9],
};

const MARGIN_MM = 12;
const FOOTER_MM = 10;

const DISCLAIMER =
  'Concept design only — not construction documentation; not checked against building codes.';

export interface PdfResult {
  ok: boolean;
  message?: string;
}

export async function exportActivePdf(paper: PaperName, scaleChoice: ScaleChoice): Promise<PdfResult> {
  const state = useApp.getState();
  const plan = state.variants.find((v) => v.id === state.activeVariantId) ?? state.variants[0];
  if (!plan) return { ok: false, message: 'Nothing to export yet — generate a layout first.' };

  const specs = new Map<string, RoomSpec>(state.program.rooms.map((r) => [r.id, r]));
  const vb = planViewBox(plan);
  const [paperW, paperH] = PAPER_MM[paper];
  const availW = paperW - 2 * MARGIN_MM;
  const availH = paperH - 2 * MARGIN_MM - FOOTER_MM;

  // world is mm; at 1:N one paper-mm shows N world-mm
  const neededScale = Math.max(vb.w / availW, vb.h / availH);
  let scale: number;
  if (scaleChoice === 'fit') {
    const nice = [20, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500];
    scale = nice.find((n) => n >= neededScale) ?? Math.ceil(neededScale);
  } else {
    scale = scaleChoice;
    if (scale < neededScale) {
      const suggestion = ([50, 100, 200] as const).find((n) => n >= neededScale);
      return {
        ok: false,
        message: `1:${scale} does not fit on ${paper.toUpperCase()} — try ${suggestion ? `1:${suggestion}` : '"fit"'} or larger paper.`,
      };
    }
  }

  const svgMarkup = planToSvgDocument(plan, { specs, unitSystem: state.unitSystem });
  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.left = '-100000px';
  holder.innerHTML = svgMarkup;
  const svgEl = holder.querySelector('svg');
  if (!svgEl) return { ok: false, message: 'PDF export failed to build the drawing.' };
  document.body.appendChild(holder);

  try {
    const drawW = vb.w / scale;
    const drawH = vb.h / scale;
    const x = MARGIN_MM + (availW - drawW) / 2;
    const y = MARGIN_MM + (availH - drawH) / 2;

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: paper });
    await pdf.svg(svgEl, { x, y, width: drawW, height: drawH });

    // scale bar: 1 m (or 5 m when zoomed far out)
    const barMetres = scale > 150 ? 5 : 1;
    const barMm = (barMetres * 1000) / scale;
    const barY = paperH - MARGIN_MM - 4;
    pdf.setDrawColor(30);
    pdf.setLineWidth(0.5);
    pdf.line(MARGIN_MM, barY, MARGIN_MM + barMm, barY);
    pdf.line(MARGIN_MM, barY - 1.2, MARGIN_MM, barY + 1.2);
    pdf.line(MARGIN_MM + barMm, barY - 1.2, MARGIN_MM + barMm, barY + 1.2);
    pdf.setFontSize(7);
    pdf.text(`${barMetres} m`, MARGIN_MM + barMm + 2, barY + 1);

    pdf.setFontSize(8);
    pdf.text(
      `${state.projectName} — 1:${scale} — seed ${plan.seed} — ${dateStamp()}`,
      MARGIN_MM,
      paperH - MARGIN_MM + 4,
    );
    pdf.setFontSize(7);
    pdf.setTextColor(120);
    pdf.text(DISCLAIMER, paperW - MARGIN_MM, paperH - MARGIN_MM + 4, { align: 'right' });

    pdf.save(`${safeFilename(state.projectName)}-${dateStamp()}-seed${plan.seed}.pdf`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: `PDF export failed (${err instanceof Error ? err.message : String(err)}) — the SVG export always works.`,
    };
  } finally {
    holder.remove();
  }
}
