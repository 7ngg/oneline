# oneline

A local-first floor-plan generator for single-floor flats, in the spirit of Finch3D and Synaps but
deliberately small: describe rooms + draw a plot → get editable, scored layout variants with walls,
doors, windows, metrics, and exports.

```
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: property tests + golden files
npm run lint       # eslint (engine purity boundary enforced)
npm run typecheck  # tsc --noEmit, strict + exactOptionalPropertyTypes
npm run build      # production build (dist/)
```

## How it works

- **Inputs** — a room program (types, target areas, min widths, adjacency wishes) and a plot boundary
  (drawn on canvas or quick rectangle) with setbacks and an entrance hint. Optional: describe the flat
  in plain text and let Gemini pre-fill the form (bring-your-own-key, off by default).
- **Engine** (`src/engine`, pure TS, framework-free — ESLint-enforced) — a deterministic pipeline:
  validate → normalize → footprint (setback offset) → feasibility precheck (with ranked one-click
  relaxations) → slicing-tree candidates → seeded simulated annealing → diversity selection →
  walls/doors/windows → output validation → repair → metrics. The pipeline is a *total function*:
  it never throws; every failure mode is a typed violation with a message and often a machine-applicable
  fix.
- **Determinism** — all randomness flows from one seeded RNG; identical seeds give byte-identical
  results (that's what the golden-file tests pin down). Wall-clock limits only cut work short (flagged),
  never change decisions.
- **Geometry** — integer millimetres everywhere; clipper2 booleans are integer-exact, so "rooms tile the
  footprint" is an exact integer identity on rectilinear plots (sub-mm skin tolerance on diagonal
  boundaries, absorbed by the repair stage).
- **Runs in a Web Worker** — cancellable, progress-reporting, watchdogged.
- **Local-first** — projects live in IndexedDB (quarantine for corrupt records, rev-counter multi-tab
  conflict detection, in-memory fallback for private mode). JSON export/import with a strict versioned
  schema and a migration chain.
- **Editing** — drag interior walls (clamped so the tessellation stays exact), slide doors/windows,
  double-click a door to flip its swing, full undo/redo.
- **Exports** — SVG, PNG (size-capped), vector PDF (paper/scale, scale bar, disclaimer footer),
  layered DXF ($INSUNITS=4), project JSON. One shared renderer feeds the canvas and every export.

## Non-goals

No structural validity, no building-code compliance, no door-swing collision solids, no curved walls,
no multi-floor (single-storey by design; the schema has an explicit extension point). Generated plans
are concept sketches — involve an architect before building anything.

## AI input privacy

Only the optional "describe your flat" feature sends data anywhere: your typed description goes to
Google's Gemini API using your own key (stored in `localStorage`, never in project files or exports).
Everything else stays on-device. Dev builds can seed a key from gitignored `.env.local`
(`VITE_GEMINI_API_KEY=…`); production is strictly bring-your-own-key because any key bundled into a
static site is public.

## Repo map

```
src/engine     pure solver + geometry + schemas (no react/dom imports)
src/worker     solver worker + protocol + watchdogged client
src/state      zustand store; zundo history over the document slice
src/db         Dexie persistence, quarantine, multi-tab channel
src/features   plot editor, program form, generate panel, plan view/editing,
               variants, exports, NL input, settings, projects
src/lib        number/unit parsing, formatting, downloads, relaxations
src/test       fast-check arbitraries + golden files
```
