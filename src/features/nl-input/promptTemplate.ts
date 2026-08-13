export const PROMPT_RULES = `You extract a structured room program for a single-floor flat from a user's free-text description. Output JSON matching the response schema exactly.

Rules:
- rooms: one entry per room the user wants. Pick the closest type. Keep the user's naming where given ("master bedroom" → name "Master bedroom", type "bedroom").
- If the user gives a total flat size but not per-room areas, LEAVE room areas out and add one assumption noting the total.
- NEVER convert units. Report numbers exactly as the user gave them with their unit ("350 sqft" → {"value":350,"unit":"sqft"}). If no unit was given, assume m2 for areas and metres for lengths, and record that as an assumption.
- adjacency: only relationships the user stated or strongly implied ("kitchen open to living room" → required). Use the room names you output.
- plotHints: only if the user described plot/flat dimensions (width × depth).
- assumptions: EVERY guess you made (counts, sizes, types, units). Short sentences.
- unparsed: parts of the text you could not act on (budgets, styles, materials, floors/storeys, gardens).
- A vague brief ("nice flat for a family") still gets a sensible small program (living, kitchen, 2 bedrooms, bathroom, hall) with each choice listed in assumptions.
- Do not invent luxury extras the user never mentioned.`;
