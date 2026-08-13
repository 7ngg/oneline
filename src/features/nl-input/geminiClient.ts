// One fetch to Gemini, hardened per the edge-case matrix:
// key via header (never URL), 20 s abort, typed error taxonomy, strict zod
// parse with ONE retry carrying the validation issues, salvage-partials on
// final failure. The model output only ever pre-fills a form the user
// reviews — nothing model-produced executes (prompt-injection containment).

import { parseNlDraft, type NlProgramDraft } from '../../engine/schemas/nl';
import { NL_RESPONSE_SCHEMA } from '../../engine/schemas/nl';
import { GEMINI_BASE, getGeminiKey, getGeminiModel } from '../settings/apiKeyStorage';
import { PROMPT_RULES } from './promptTemplate';

export type NlResult =
  | { kind: 'ok'; draft: NlProgramDraft }
  | { kind: 'no-key' }
  | { kind: 'auth' }
  | { kind: 'rate-limit'; retryAfterS: number | null }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'server'; status: number }
  | { kind: 'model-missing'; model: string }
  | { kind: 'blocked' }
  | { kind: 'unparsable'; issues: string[]; salvaged: Partial<NlProgramDraft> | null };

const TIMEOUT_MS = 30_000;
export const NL_INPUT_MAX_CHARS = 4_000;

export async function describeToDraft(userText: string): Promise<NlResult> {
  const key = getGeminiKey();
  if (!key) return { kind: 'no-key' };
  const model = getGeminiModel();

  const call = async (extraInstruction: string | null): Promise<Response> => {
    const text =
      PROMPT_RULES +
      (extraInstruction ? `\n\nIMPORTANT CORRECTION: ${extraInstruction}` : '') +
      '\n---USER TEXT---\n' +
      userText.slice(0, NL_INPUT_MAX_CHARS);
    return fetch(
      `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema: NL_RESPONSE_SCHEMA,
          },
        }),
      },
    );
  };

  const attempt = async (
    extraInstruction: string | null,
  ): Promise<NlResult | { kind: 'retry'; issues: string[] }> => {
    let res: Response;
    try {
      res = await call(extraInstruction);
    } catch (err) {
      // AbortSignal.timeout rejects with a TimeoutError DOMException; every
      // other rejection is a genuine network/DNS/CORS failure
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        console.warn('[oneline] Gemini request timed out after', TIMEOUT_MS, 'ms');
        return { kind: 'timeout' };
      }
      console.warn('[oneline] Gemini fetch failed:', err);
      return { kind: 'offline' };
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) return { kind: 'auth' };
    if (res.status === 404) return { kind: 'model-missing', model };
    if (res.status === 429) {
      const header = res.headers.get('retry-after');
      const retryAfterS = header ? Number.parseInt(header, 10) || null : null;
      return { kind: 'rate-limit', retryAfterS };
    }
    if (!res.ok) {
      // 500/503 = Google-side hiccup (previews overload often) — NOT offline
      console.warn('[oneline] Gemini returned HTTP', res.status);
      return { kind: 'server', status: res.status };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: 'unparsable', issues: ['response was not JSON'], salvaged: null };
    }
    const candidate = (body as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> })
      .candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY') return { kind: 'blocked' };
    const text = candidate.content?.parts?.[0]?.text;
    if (!text) return { kind: 'blocked' };

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { kind: 'retry', issues: ['output was not valid JSON'] };
    }
    const parsed = parseNlDraft(raw);
    if (parsed.ok) return { kind: 'ok', draft: parsed.draft };
    return extraInstruction === null
      ? { kind: 'retry', issues: parsed.issues }
      : { kind: 'unparsable', issues: parsed.issues, salvaged: parsed.salvaged };
  };

  const first = await attempt(null);
  if (first.kind !== 'retry') return first;
  // one retry, carrying the validation issues back to the model
  const second = await attempt(
    `your previous output failed validation: ${first.issues.join('; ')}. Return corrected JSON only.`,
  );
  if (second.kind === 'retry') {
    return { kind: 'unparsable', issues: second.issues, salvaged: null };
  }
  return second;
}
