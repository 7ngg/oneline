// Shared numeric inputs: free-text parsing with explicit interpretation echo.
// Commit on blur/Enter; invalid input keeps the field marked and NEVER writes
// a silent 0 into the document.

import { useEffect, useState } from 'react';
import type { Mm, Mm2 } from '../../engine';
import { echoArea, echoLength, formatArea, formatLength } from '../../lib/format';
import { parseArea, parseLength } from '../../lib/numberParse';
import { useApp } from '../../state/store';

interface FieldProps<T> {
  label?: string;
  value: T;
  onCommit: (value: T) => void;
  width?: number;
  ariaLabel?: string;
}

export function LengthField({ label, value, onCommit, width = 90, ariaLabel }: FieldProps<Mm>) {
  const system = useApp((s) => s.unitSystem);
  const [text, setText] = useState(() => formatLength(value, system));
  const [error, setError] = useState<string | null>(null);
  const [echo, setEcho] = useState<string | null>(null);

  useEffect(() => {
    setText(formatLength(value, system));
    setError(null);
    setEcho(null);
  }, [value, system]);

  const commit = () => {
    const parsed = parseLength(text, system);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setEcho(echoLength(parsed.value, system));
    onCommit(parsed.value);
  };

  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input
        aria-label={ariaLabel ?? label}
        aria-invalid={error ? 'true' : undefined}
        style={{ width }}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setEcho(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        title={error ?? undefined}
      />
      {error ? <span className="field-error">{error}</span> : echo ? <span className="soft">{echo}</span> : null}
    </label>
  );
}

export function AreaField({ label, value, onCommit, width = 90, ariaLabel }: FieldProps<Mm2>) {
  const system = useApp((s) => s.unitSystem);
  const [text, setText] = useState(() => formatArea(value, system));
  const [error, setError] = useState<string | null>(null);
  const [echo, setEcho] = useState<string | null>(null);

  useEffect(() => {
    setText(formatArea(value, system));
    setError(null);
    setEcho(null);
  }, [value, system]);

  const commit = () => {
    const parsed = parseArea(text, system);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.value <= 0) {
      setError('Must be positive.');
      return;
    }
    setError(null);
    setEcho(echoArea(parsed.value, system));
    onCommit(parsed.value);
  };

  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      <input
        aria-label={ariaLabel ?? label}
        aria-invalid={error ? 'true' : undefined}
        style={{ width }}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setEcho(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        title={error ?? undefined}
      />
      {error ? <span className="field-error">{error}</span> : echo ? <span className="soft">{echo}</span> : null}
    </label>
  );
}
