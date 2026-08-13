// "Describe your flat" panel. Hidden entirely until a Gemini key exists.
// Success path: draft → amber assumption chips the user must review →
// Apply replaces the program (one undo step) and jumps to the Rooms form.

import { useState } from 'react';
import type { NlProgramDraft } from '../../engine/schemas/nl';
import { mm, v, type Plot } from '../../engine';
import { draftToProgram, plotHintToRect } from '../../lib/nlDraft';
import { useApp } from '../../state/store';
import { describeToDraft, NL_INPUT_MAX_CHARS, type NlResult } from './geminiClient';

type Phase =
  | { name: 'idle' }
  | { name: 'busy' }
  | { name: 'review'; draft: NlProgramDraft; dismissed: boolean[] }
  | { name: 'error'; message: string; salvage?: NlProgramDraft };

export function NlInputPanel({ onApplied }: { onApplied: () => void }) {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const setProgram = useApp((s) => s.setProgram);
  const setPlot = useApp((s) => s.setPlot);
  const plot = useApp((s) => s.plot);

  const submit = async () => {
    setPhase({ name: 'busy' });
    const result = await describeToDraft(text);
    setPhase(toPhase(result));
  };

  const apply = (draft: NlProgramDraft) => {
    const { program, notes } = draftToProgram(draft);
    setProgram(program);
    const rect = plotHintToRect(draft);
    if (rect && plot.boundary.length === 0) {
      const next: Plot = {
        boundary: [v(0, 0), v(rect.w, 0), v(rect.w, rect.d), v(0, rect.d)],
        setback: { uniform: mm(0) },
        northDeg: 0,
      };
      setPlot(next);
    }
    if (notes.length > 0) useApp.getState().setBanner(notes.join(' '));
    setPhase({ name: 'idle' });
    setText('');
    onApplied();
  };

  return (
    <div className="stack nl-panel">
      <strong>Describe your flat</strong>
      <textarea
        aria-label="Describe your flat"
        rows={4}
        maxLength={NL_INPUT_MAX_CHARS}
        placeholder='e.g. "2-bedroom flat around 75 m², open kitchen towards the living room, bathroom near the entrance"'
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={phase.name === 'busy'}
      />
      <div className="row">
        <span className="soft">
          {text.length}/{NL_INPUT_MAX_CHARS}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="primary"
          disabled={text.trim().length < 8 || phase.name === 'busy'}
          onClick={() => void submit()}
        >
          {phase.name === 'busy' ? 'Reading…' : 'Draft rooms'}
        </button>
      </div>

      {phase.name === 'error' && (
        <div className="stack">
          <p className="inline-violation warning">{phase.message}</p>
          {phase.salvage && (
            <button
              onClick={() =>
                setPhase({
                  name: 'review',
                  draft: phase.salvage as NlProgramDraft,
                  dismissed: (phase.salvage as NlProgramDraft).assumptions.map(() => false),
                })
              }
            >
              Use the {phase.salvage.rooms.length} room{phase.salvage.rooms.length === 1 ? '' : 's'} that were
              read
            </button>
          )}
        </div>
      )}

      {phase.name === 'review' && (
        <div className="stack">
          <p className="soft">
            Drafted {phase.draft.rooms.length} room{phase.draft.rooms.length === 1 ? '' : 's'}. Review the
            assumptions, then apply:
          </p>
          {phase.draft.assumptions.map((a, i) => (
            <label key={i} className={`chip ${phase.dismissed[i] ? 'chip-ok' : ''}`}>
              <input
                type="checkbox"
                checked={phase.dismissed[i] ?? false}
                onChange={(e) =>
                  setPhase({
                    ...phase,
                    dismissed: phase.dismissed.map((d, j) => (j === i ? e.target.checked : d)),
                  })
                }
              />
              {a}
            </label>
          ))}
          {phase.draft.unparsed.length > 0 && (
            <p className="soft">Not used: {phase.draft.unparsed.join('; ')}</p>
          )}
          <div className="row">
            <button
              className="primary"
              disabled={!phase.dismissed.every(Boolean)}
              title={
                phase.dismissed.every(Boolean)
                  ? undefined
                  : 'Tick each assumption to confirm you have seen it'
              }
              onClick={() => apply(phase.draft)}
            >
              Apply to program
            </button>
            <button onClick={() => setPhase({ name: 'idle' })}>Discard</button>
          </div>
        </div>
      )}

      <p className="soft">
        This text is sent to Google's Gemini API using your key. Everything else stays on your device.
      </p>
    </div>
  );
}

function toPhase(result: NlResult): Phase {
  switch (result.kind) {
    case 'ok':
      if (result.draft.rooms.length === 0) {
        return { name: 'error', message: 'No rooms could be read from that — try being more specific, or use the form below.' };
      }
      return {
        name: 'review',
        draft: result.draft,
        dismissed: result.draft.assumptions.map(() => false),
      };
    case 'no-key':
      return { name: 'error', message: 'No API key set — add one in Settings.' };
    case 'auth':
      return { name: 'error', message: 'The key was rejected — check it in Settings.' };
    case 'rate-limit':
      return {
        name: 'error',
        message: `Free-tier limit reached — try again in ${result.retryAfterS ? `${result.retryAfterS} s` : 'about a minute'}.`,
      };
    case 'offline':
      return {
        name: 'error',
        message: 'Could not reach the Gemini API — the AI input needs a connection; the rest of the app works offline.',
      };
    case 'timeout':
      return {
        name: 'error',
        message: 'Gemini took too long to answer (30 s) — usually a busy model; try again.',
      };
    case 'server':
      return {
        name: 'error',
        message: `Gemini had a hiccup (HTTP ${result.status}) — Google-side, usually momentary; try again.`,
      };
    case 'model-missing':
      return {
        name: 'error',
        message: `Model "${result.model}" was not found — set a different model in Settings.`,
      };
    case 'blocked':
      return { name: 'error', message: "Couldn't process this text — try rewording it." };
    case 'unparsable': {
      const salvagedRooms = result.salvaged?.rooms;
      const base = {
        name: 'error' as const,
        message: `Couldn't fully understand the answer (${result.issues[0] ?? 'invalid output'}) — please use the form below.`,
      };
      if (salvagedRooms && salvagedRooms.length > 0) {
        return {
          ...base,
          salvage: {
            rooms: salvagedRooms,
            adjacency: [],
            assumptions: ['Only part of the answer could be read — review these rooms carefully.'],
            unparsed: [],
          },
        };
      }
      return base;
    }
  }
}
