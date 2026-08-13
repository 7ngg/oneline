import { m2FromMm2, mm, type Mm2 } from '../units';
import { violation, type Violation } from '../violations';
import { ROOM_COUNT_HARD_CAP, ROOM_COUNT_PERF_WARN, type Program } from './types';

/** Stage 1 (program half): semantic validation → violations, never throws. */
export function validateProgram(program: Program): Violation[] {
  const out: Violation[] = [];
  const { rooms, adjacency } = program;

  if (rooms.length === 0) {
    out.push(violation('PROGRAM_EMPTY', 'error', 'Add at least one room to generate a plan.', ['program']));
    return out;
  }
  if (rooms.length > ROOM_COUNT_HARD_CAP) {
    out.push(
      violation(
        'ROOM_COUNT_EXCEEDED',
        'error',
        `${rooms.length} rooms exceeds the maximum of ${ROOM_COUNT_HARD_CAP} for a flat.`,
        ['program'],
      ),
    );
  } else if (rooms.length > ROOM_COUNT_PERF_WARN) {
    out.push(
      violation(
        'ROOM_COUNT_PERF_WARNING',
        'warning',
        `${rooms.length} rooms — generation may be slow above ${ROOM_COUNT_PERF_WARN}.`,
        ['program'],
      ),
    );
  }

  const ids = new Set(rooms.map((r) => r.id));
  for (const room of rooms) {
    const { min, ideal, max } = room.area;
    if (!(min > 0 && min <= ideal && ideal <= max)) {
      out.push(
        violation(
          'ROOM_AREA_RANGE_INVALID',
          'error',
          `"${room.name}": areas must satisfy 0 < min ≤ ideal ≤ max (got ${fmtM2(min)} / ${fmtM2(ideal)} / ${fmtM2(max)} m²).`,
          [room.id],
        ),
      );
    }
    if (room.minDim <= 0) {
      out.push(
        violation('ROOM_MINDIM_INCONSISTENT', 'error', `"${room.name}": minimum dimension must be positive.`, [
          room.id,
        ]),
      );
    } else if (room.minDim * room.minDim > room.area.max) {
      const bound = Math.floor(Math.sqrt(room.area.max) / 100) * 100;
      out.push(
        violation(
          'ROOM_MINDIM_INCONSISTENT',
          'error',
          `"${room.name}": a room of at most ${fmtM2(room.area.max)} m² cannot be ${room.minDim / 1000} m wide in both directions — reduce min dimension to ≤ ${bound / 1000} m or raise max area.`,
          [room.id],
          { label: `Set min dimension to ${bound / 1000} m`, relaxation: { kind: 'roomMinDim', roomId: room.id, value: mm(bound) } },
        ),
      );
    }
  }

  // conflicting rules on the same pair
  const kindsByPair = new Map<string, Set<string>>();
  for (const rule of adjacency) {
    if (!ids.has(rule.a) || !ids.has(rule.b) || rule.a === rule.b) continue; // normalize drops these
    const key = [rule.a, rule.b].sort().join('|');
    const set = kindsByPair.get(key) ?? new Set();
    set.add(rule.kind);
    kindsByPair.set(key, set);
  }
  for (const [pair, kinds] of kindsByPair) {
    if ((kinds.has('required') || kinds.has('preferred')) && kinds.has('avoid')) {
      const [a, b] = pair.split('|') as [string, string];
      const nameOf = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;
      out.push(
        violation(
          'ADJACENCY_CONFLICT',
          'error',
          `"${nameOf(a)}" and "${nameOf(b)}" are marked both adjacent and apart — remove one rule.`,
          [a, b],
        ),
      );
    }
  }

  // Euler necessary condition: a planar graph has E ≤ 3V − 6 (V ≥ 3)
  const positiveEdges = [...kindsByPair.entries()].filter(([, k]) => k.has('required') || k.has('preferred'));
  const v = rooms.length;
  if (v >= 3 && positiveEdges.length > 3 * v - 6) {
    out.push(
      violation(
        'ADJACENCY_NONPLANAR_HINT',
        'warning',
        `${positiveEdges.length} adjacency wishes between ${v} rooms cannot all hold at once on a single floor — the best layouts will satisfy a subset.`,
        ['program'],
      ),
    );
  }

  if (program.circulation.factor < 0 || program.circulation.factor > 0.35) {
    out.push(
      violation(
        'AREA_TIGHT',
        'warning',
        `Circulation factor ${program.circulation.factor} is outside the usual 0–0.35 range and will be clamped.`,
        ['program'],
      ),
    );
  }

  return out;
}

const fmtM2 = (a: Mm2): string => m2FromMm2(a).toFixed(1);
