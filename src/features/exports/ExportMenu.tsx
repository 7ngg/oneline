import { useRef, useState } from 'react';
import { useApp } from '../../state/store';
import { exportProjectJson, importProjectJson } from './exportJson';
import type { PaperName, ScaleChoice } from './exportPdf';
import { exportActivePng } from './exportPng';
import { exportActiveSvg } from './exportSvg';

// jspdf and the DXF writer are heavyweight — loaded on demand only
const runPdf = async (paper: PaperName, scale: ScaleChoice) =>
  (await import('./exportPdf')).exportActivePdf(paper, scale);
const runDxf = async () => (await import('./exportDxf')).exportActiveDxf();

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [paper, setPaper] = useState<PaperName>('a4');
  const [scale, setScale] = useState<ScaleChoice>('fit');
  const fileInput = useRef<HTMLInputElement>(null);
  const setBanner = useApp((s) => s.setBanner);

  const close = () => setOpen(false);

  return (
    <span style={{ position: 'relative' }}>
      <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        Export ▾
      </button>
      {open && (
        <div className="menu" role="menu" onMouseLeave={close}>
          <button role="menuitem" onClick={() => (exportProjectJson(), close())}>
            Project (.json)
          </button>
          <button role="menuitem" onClick={() => (exportActiveSvg(), close())}>
            Active plan (.svg)
          </button>
          <button role="menuitem" onClick={() => (exportActivePng(), close())}>
            Active plan (.png)
          </button>
          <button role="menuitem" onClick={() => (void runDxf(), close())}>
            Active plan (.dxf)
          </button>
          <div className="menu-row" role="none">
            <button
              role="menuitem"
              onClick={() => {
                void runPdf(paper, scale).then((r) => {
                  if (!r.ok && r.message) setBanner(r.message);
                });
                close();
              }}
            >
              Active plan (.pdf)
            </button>
            <select aria-label="Paper" value={paper} onChange={(e) => setPaper(e.target.value as PaperName)}>
              <option value="a4">A4</option>
              <option value="a3">A3</option>
              <option value="letter">Letter</option>
            </select>
            <select
              aria-label="Scale"
              value={String(scale)}
              onChange={(e) => setScale(e.target.value === 'fit' ? 'fit' : (Number(e.target.value) as ScaleChoice))}
            >
              <option value="fit">fit</option>
              <option value="50">1:50</option>
              <option value="100">1:100</option>
              <option value="200">1:200</option>
            </select>
          </div>
          <button role="menuitem" onClick={() => (fileInput.current?.click(), close())}>
            Import project…
          </button>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importProjectJson(file);
          e.target.value = '';
        }}
      />
    </span>
  );
}
