import { useState } from 'react';

const KEY = 'oneline.disclaimerAccepted';

const wasAccepted = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // private mode: show every session, it's one click
  }
};

export function DisclaimerModal() {
  const [accepted, setAccepted] = useState(wasAccepted);
  if (accepted) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Before you start">
      <div className="dialog" style={{ maxWidth: 460 }}>
        <strong>Before you start</strong>
        <p>
          oneline is a <em>concept-design</em> tool. Generated plans are sketches for exploring layout ideas —
          they are <strong>not construction documentation</strong>, are not checked against any building code,
          and make no claims about structural validity. Always involve a qualified architect or engineer before
          building anything.
        </p>
        <p className="soft">
          Everything you draw stays on this device. Only the optional AI text input sends data (your typed
          description) to an external service, and only when you configure it.
        </p>
        <button
          className="primary"
          onClick={() => {
            try {
              localStorage.setItem(KEY, '1');
            } catch {
              // private mode — accept for this session only
            }
            setAccepted(true);
          }}
        >
          Understood
        </button>
      </div>
    </div>
  );
}
