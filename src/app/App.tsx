import { useEffect, useState } from 'react';
import { DisclaimerModal } from './DisclaimerModal';
import { ExportMenu } from '../features/exports/ExportMenu';
import { GeneratePanel } from '../features/generate/GeneratePanel';
import { NlInputPanel } from '../features/nl-input/NlInputPanel';
import { getGeminiKey } from '../features/settings/apiKeyStorage';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { PlanCanvas } from '../features/plan-view/PlanCanvas';
import { PlotEditor } from '../features/plot-editor/PlotEditor';
import { ProgramForm } from '../features/program-form/ProgramForm';
import { ProjectListDialog } from '../features/projects/ProjectListDialog';
import { InspectorPanels } from '../features/variants/InspectorPanels';
import { VariantStrip } from '../features/variants/VariantStrip';
import {
  openMostRecentOrNew,
  reloadTheirs,
  saveMineAsCopy,
  startAutosave,
} from '../features/projects/projectService';
import { initSettings, useApp } from '../state/store';

function UndoRedo() {
  const temporal = useApp.temporal;
  const [, force] = useState(0);
  useEffect(() => temporal.subscribe(() => force((n) => n + 1)), [temporal]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) temporal.getState().redo();
        else temporal.getState().undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        temporal.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [temporal]);
  const { pastStates, futureStates } = temporal.getState();
  return (
    <span className="row" style={{ gap: 4 }}>
      <button
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
        disabled={pastStates.length === 0}
        onClick={() => temporal.getState().undo()}
      >
        ↶
      </button>
      <button
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
        disabled={futureStates.length === 0}
        onClick={() => temporal.getState().redo()}
      >
        ↷
      </button>
    </span>
  );
}

function PlotHint() {
  const unitSystem = useApp((s) => s.unitSystem);
  const setUnitSystem = useApp((s) => s.setUnitSystem);
  return (
    <div className="stack">
      <p className="soft">
        Draw the plot boundary in the canvas: click to place corners, click the first corner to close. Shift-drag
        pans, scroll zooms. Drawing a plot is optional — with none drawn, Generate invents one sized to your
        rooms.
      </p>
      <label className="check">
        units
        <select value={unitSystem} onChange={(e) => setUnitSystem(e.target.value as 'metric' | 'imperial')}>
          <option value="metric">metric (m)</option>
          <option value="imperial">imperial (ft)</option>
        </select>
      </label>
    </div>
  );
}

export function App() {
  const projectName = useApp((s) => s.projectName);
  const setProjectName = useApp((s) => s.setProjectName);
  const banner = useApp((s) => s.banner);
  const setBanner = useApp((s) => s.setBanner);
  const conflictRev = useApp((s) => s.conflictRev);
  const dirty = useApp((s) => s.dirty);
  const projectId = useApp((s) => s.projectId);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyVersion, setKeyVersion] = useState(0);
  const [railTab, setRailTab] = useState<'program' | 'plot' | 'generate'>('program');
  // re-evaluated when the settings dialog reports a key change
  const hasGeminiKey = keyVersion >= 0 && getGeminiKey() !== null;

  useEffect(() => {
    initSettings();
    const stopAutosave = startAutosave();
    if (!useApp.getState().projectId) {
      void openMostRecentOrNew();
    }
    return stopAutosave;
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo">oneline</span>
        <input
          aria-label="Project name"
          className="project-name"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
        />
        <span className="soft">{projectId ? (dirty ? 'saving…' : 'saved') : ''}</span>
        <span style={{ flex: 1 }} />
        <UndoRedo />
        <ExportMenu />
        <button onClick={() => setSettingsOpen(true)}>Settings</button>
        <button onClick={() => setProjectsOpen(true)}>Projects</button>
      </header>

      {conflictRev !== null && (
        <div className="conflict-bar" role="alert">
          This project changed in another tab.
          <button onClick={() => void reloadTheirs()}>Load their version</button>
          <button onClick={() => void saveMineAsCopy()}>Save mine as copy</button>
        </div>
      )}
      {banner && (
        <div className="banner" role="status">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)}>✕</button>
        </div>
      )}

      <main className="workspace">
        <aside className="rail" aria-label="Inputs">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={railTab === 'program'} onClick={() => setRailTab('program')}>
              Rooms
            </button>
            <button role="tab" aria-selected={railTab === 'plot'} onClick={() => setRailTab('plot')}>
              Plot
            </button>
            <button role="tab" aria-selected={railTab === 'generate'} onClick={() => setRailTab('generate')}>
              Generate
            </button>
          </div>
          {railTab === 'program' && (
            <>
              {hasGeminiKey && <NlInputPanel onApplied={() => setRailTab('program')} />}
              <ProgramForm />
            </>
          )}
          {railTab === 'plot' && <PlotHint />}
          {railTab === 'generate' && <GeneratePanel />}
        </aside>
        <section className="canvas-holder" aria-label="Plan view">
          {railTab === 'plot' ? (
            <PlotEditor />
          ) : (
            <div className="plan-area">
              <PlanCanvas />
              <VariantStrip />
            </div>
          )}
        </section>
        <aside className="inspector" aria-label="Inspector">
          <InspectorPanels />
        </aside>
      </main>

      <footer className="statusbar">
        Concept-design tool — output is not construction documentation and is not checked against building
        codes.
      </footer>

      <ProjectListDialog open={projectsOpen} onClose={() => setProjectsOpen(false)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onKeyChanged={() => setKeyVersion((n) => n + 1)}
      />
      <DisclaimerModal />
    </div>
  );
}
