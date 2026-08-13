// Apply a machine-readable relaxation (from a violation fix) to the document.

import type { Plot, Program, Relaxation } from '../engine';
import { mm2 } from '../engine';

export function applyRelaxation(
  program: Program,
  plot: Plot,
  relaxation: Relaxation,
): { program: Program; plot: Plot } {
  switch (relaxation.kind) {
    case 'setbackUniform':
      return { program, plot: { ...plot, setback: { uniform: relaxation.value } } };
    case 'circulationFactor':
      return {
        program: { ...program, circulation: { mode: 'implicit', factor: relaxation.value } },
        plot,
      };
    case 'roomAreaMin':
      return {
        program: {
          ...program,
          rooms: program.rooms.map((room) =>
            room.id === relaxation.roomId
              ? {
                  ...room,
                  area: {
                    min: relaxation.value,
                    ideal: mm2(Math.max(relaxation.value, room.area.ideal)),
                    max: mm2(Math.max(relaxation.value, room.area.max)),
                  },
                }
              : room,
          ),
        },
        plot,
      };
    case 'roomMinDim':
      return {
        program: {
          ...program,
          rooms: program.rooms.map((room) =>
            room.id === relaxation.roomId ? { ...room, minDim: relaxation.value } : room,
          ),
        },
        plot,
      };
    case 'dropAdjacency':
      return {
        program: {
          ...program,
          adjacency: program.adjacency.filter(
            (rule) =>
              !(
                (rule.a === relaxation.a && rule.b === relaxation.b) ||
                (rule.a === relaxation.b && rule.b === relaxation.a)
              ),
          ),
        },
        plot,
      };
  }
}
