import { mm2, type Mm2 } from '../units';
import type { AdjacencyRule, Program } from './types';

/**
 * Stage 2 (program half): canonicalize a validated program. Pure — returns a
 * new Program. Drops dangling/self/duplicate adjacency rules (keeping the
 * strongest), dedupes display names, clamps ideal areas and the circulation
 * factor into range.
 */
export function normalizeProgram(program: Program): Program {
  const ids = new Set(program.rooms.map((r) => r.id));

  // dedupe names: "Bedroom", "Bedroom 2", …
  const seen = new Map<string, number>();
  const rooms = program.rooms.map((room) => {
    const base = room.name.trim() || 'Room';
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    const name = count === 1 ? base : `${base} ${count}`;
    const min = room.area.min;
    const max = room.area.max < min ? min : room.area.max;
    const ideal = mm2(Math.min(Math.max(room.area.ideal, min), max)) as Mm2;
    return { ...room, name, area: { min, ideal, max } };
  });

  const byPair = new Map<string, AdjacencyRule>();
  const strength = { avoid: 0, preferred: 1, required: 2 } as const;
  for (const rule of program.adjacency) {
    if (!ids.has(rule.a) || !ids.has(rule.b) || rule.a === rule.b) continue;
    const key = [rule.a, rule.b].sort().join('|');
    const existing = byPair.get(key);
    if (
      !existing ||
      strength[rule.kind] > strength[existing.kind] ||
      (rule.kind === existing.kind && rule.weight > existing.weight)
    ) {
      byPair.set(key, rule);
    }
  }

  return {
    rooms,
    adjacency: [...byPair.values()],
    circulation: {
      mode: 'implicit',
      factor: Math.min(Math.max(program.circulation.factor, 0), 0.35),
    },
    defaults: program.defaults,
  };
}
