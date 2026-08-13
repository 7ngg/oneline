import { useState } from 'react';
import {
  clearGeminiKey,
  DEFAULT_GEMINI_MODEL,
  getGeminiKey,
  getGeminiModel,
  setGeminiKey,
  setGeminiModel,
  testGeminiKey,
} from './apiKeyStorage';

interface Props {
  open: boolean;
  onClose: () => void;
  onKeyChanged: () => void;
}

export function SettingsDialog({ open, onClose, onKeyChanged }: Props) {
  const [keyInput, setKeyInput] = useState('');
  const [model, setModel] = useState(getGeminiModel);
  const [status, setStatus] = useState<string | null>(null);
  const hasKey = getGeminiKey() !== null;

  if (!open) return null;

  return (
    <div className="overlay" role="dialog" aria-label="Settings">
      <div className="dialog" style={{ maxWidth: 440 }}>
        <div className="dialog-head">
          <strong>Settings — AI text input</strong>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Close</button>
        </div>

        <p className="soft">
          The optional "describe your flat" feature calls Google's Gemini API with your own key. Text you
          type there is sent to Google; everything else stays on this device. The key is stored only in this
          browser.
        </p>

        <label className="field" style={{ width: '100%' }}>
          <span className="field-label">API key</span>
          <input
            type="password"
            style={{ flex: 1 }}
            placeholder={hasKey ? '•••••••• (key saved)' : 'paste your Gemini API key'}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="row">
          <button
            className="primary"
            disabled={keyInput.trim().length < 8}
            onClick={() => {
              setGeminiKey(keyInput);
              setKeyInput('');
              setStatus('Key saved.');
              onKeyChanged();
            }}
          >
            Save key
          </button>
          <button
            disabled={!hasKey && keyInput.trim().length < 8}
            onClick={() => {
              const candidate = keyInput.trim() || getGeminiKey() || '';
              setStatus('Testing…');
              void testGeminiKey(candidate).then((r) => setStatus(r.message));
            }}
          >
            Test key
          </button>
          {hasKey && (
            <button
              onClick={() => {
                clearGeminiKey();
                setStatus('Key removed.');
                onKeyChanged();
              }}
            >
              Remove key
            </button>
          )}
        </div>

        <label className="field" style={{ width: '100%' }}>
          <span className="field-label">model</span>
          <input
            style={{ flex: 1 }}
            value={model}
            placeholder={DEFAULT_GEMINI_MODEL}
            onChange={(e) => {
              setModel(e.target.value);
              setGeminiModel(e.target.value);
            }}
          />
        </label>
        <p className="soft">
          Default: {DEFAULT_GEMINI_MODEL}. If Google retires it, set a current model name here.
        </p>

        {status && <p className="inline-violation info">{status}</p>}
      </div>
    </div>
  );
}
