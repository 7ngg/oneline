// Gemini key storage: localStorage ONLY — never in project files, exports, or
// IndexedDB. In dev builds a gitignored .env.local can seed the initial value
// (VITE_ vars are baked into the bundle, so production relies exclusively on
// bring-your-own-key).

const KEY = 'oneline.geminiKey';
const MODEL_KEY = 'oneline.geminiModel';

// gemini-2.5-flash was retired for new users mid-2026; 3.5-flash verified
// against this app's responseSchema JSON mode. Overridable in Settings (N12).
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

export function getGeminiKey(): string | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
  } catch {
    return null;
  }
  if (import.meta.env.DEV) {
    const dev = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
    if (dev) return dev;
  }
  return null;
}

export function setGeminiKey(key: string): void {
  try {
    localStorage.setItem(KEY, key.trim());
  } catch {
    // private mode: key works for this session via the caller's state only
  }
}

export function clearGeminiKey(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function getGeminiModel(): string {
  try {
    return localStorage.getItem(MODEL_KEY) || DEFAULT_GEMINI_MODEL;
  } catch {
    return DEFAULT_GEMINI_MODEL;
  }
}

export function setGeminiModel(model: string): void {
  try {
    if (model.trim()) localStorage.setItem(MODEL_KEY, model.trim());
    else localStorage.removeItem(MODEL_KEY);
  } catch {
    // ignore
  }
}

/** Cheapest possible auth check: list models with the key. */
export async function testGeminiKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true, message: 'Key works.' };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, message: 'The key was rejected by Google.' };
    }
    return { ok: false, message: `Unexpected response (${res.status}).` };
  } catch {
    return { ok: false, message: 'Could not reach the Gemini API — check your connection.' };
  }
}
