import { useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import type { AdjacencyRule, Program, RoomSpec, RoomType, Violation } from '../../engine';
import { defaultAreaRange, ROOM_TYPE_DEFAULTS, validateProgram } from '../../engine';
import { useApp } from '../../state/store';
import { AreaField, LengthField } from './fields';

const ROOM_TYPES = Object.keys(ROOM_TYPE_DEFAULTS) as RoomType[];

export function makeRoom(type: RoomType): RoomSpec {
  const defaults = ROOM_TYPE_DEFAULTS[type];
  return {
    id: nanoid(8),
    name: defaults.label,
    type,
    area: defaultAreaRange(type),
    minDim: defaults.minDim,
    prefs: { ...defaults.prefs },
  };
}

export function ProgramForm() {
  const program = useApp((s) => s.program);
  const setProgram = useApp((s) => s.setProgram);
  const [expanded, setExpanded] = useState<string | null>(null);

  const violations = useMemo(() => validateProgram(program), [program]);
  const byRoom = useMemo(() => {
    const map = new Map<string, Violation[]>();
    for (const v of violations) {
      for (const s of v.subjects) {
        map.set(s, [...(map.get(s) ?? []), v]);
      }
    }
    return map;
  }, [violations]);

  const update = (patch: Partial<Program>) => setProgram({ ...program, ...patch });
  const updateRoom = (id: string, patch: Partial<RoomSpec>) =>
    update({ rooms: program.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  return (
    <div className="stack">
      <div className="row wrap" role="group" aria-label="Add room">
        {(['bedroom', 'bathroom', 'kitchen', 'living', 'hall'] as RoomType[]).map((t) => (
          <button key={t} onClick={() => update({ rooms: [...program.rooms, makeRoom(t)] })}>
            + {ROOM_TYPE_DEFAULTS[t].label}
          </button>
        ))}
        <select
          aria-label="Add other room type"
          value=""
          onChange={(e) => {
            if (e.target.value) update({ rooms: [...program.rooms, makeRoom(e.target.value as RoomType)] });
          }}
        >
          <option value="">more…</option>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ROOM_TYPE_DEFAULTS[t].label}
            </option>
          ))}
        </select>
      </div>

      {program.rooms.length === 0 && <p className="soft">No rooms yet — add some above.</p>}

      <ul className="room-list">
        {program.rooms.map((room) => {
          const roomViolations = byRoom.get(room.id) ?? [];
          const isOpen = expanded === room.id;
          return (
            <li key={room.id} className={roomViolations.some((v) => v.severity === 'error') ? 'has-error' : ''}>
              <div className="row">
                <input
                  aria-label="Room name"
                  value={room.name}
                  style={{ width: 110 }}
                  onChange={(e) => updateRoom(room.id, { name: e.target.value })}
                />
                <select
                  aria-label="Room type"
                  value={room.type}
                  onChange={(e) => {
                    const type = e.target.value as RoomType;
                    const d = ROOM_TYPE_DEFAULTS[type];
                    updateRoom(room.id, {
                      type,
                      area: defaultAreaRange(type),
                      minDim: d.minDim,
                      prefs: { ...d.prefs },
                      name: room.name === ROOM_TYPE_DEFAULTS[room.type].label ? d.label : room.name,
                    });
                  }}
                >
                  {ROOM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ROOM_TYPE_DEFAULTS[t].label}
                    </option>
                  ))}
                </select>
                <AreaField
                  ariaLabel={`${room.name} target area`}
                  value={room.area.ideal}
                  width={70}
                  onCommit={(ideal) =>
                    updateRoom(room.id, {
                      area: {
                        min: ideal < room.area.min ? ideal : room.area.min,
                        ideal,
                        max: ideal > room.area.max ? ideal : room.area.max,
                      },
                    })
                  }
                />
                <button aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : room.id)}>
                  {isOpen ? '▾' : '▸'}
                </button>
                <button
                  aria-label={`Remove ${room.name}`}
                  onClick={() =>
                    update({
                      rooms: program.rooms.filter((r) => r.id !== room.id),
                      adjacency: program.adjacency.filter((a) => a.a !== room.id && a.b !== room.id),
                    })
                  }
                >
                  ✕
                </button>
              </div>
              {isOpen && (
                <div className="room-detail">
                  <div className="row wrap">
                    <AreaField
                      label="min"
                      value={room.area.min}
                      width={64}
                      onCommit={(min) => updateRoom(room.id, { area: { ...room.area, min } })}
                    />
                    <AreaField
                      label="max"
                      value={room.area.max}
                      width={64}
                      onCommit={(max) => updateRoom(room.id, { area: { ...room.area, max } })}
                    />
                    <LengthField
                      label="min width"
                      value={room.minDim}
                      width={64}
                      onCommit={(minDim) => updateRoom(room.id, { minDim })}
                    />
                  </div>
                  <div className="row wrap">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={room.prefs.exteriorWall ?? false}
                        onChange={(e) =>
                          updateRoom(room.id, { prefs: { ...room.prefs, exteriorWall: e.target.checked } })
                        }
                      />
                      window wall
                    </label>
                    <label className="check">
                      facing
                      <select
                        value={room.prefs.orientation ?? ''}
                        onChange={(e) => {
                          const { orientation: _dropped, ...rest } = room.prefs;
                          updateRoom(room.id, {
                            prefs: e.target.value
                              ? { ...rest, orientation: e.target.value as 'N' | 'E' | 'S' | 'W' }
                              : rest,
                          });
                        }}
                      >
                        <option value="">any</option>
                        <option value="N">north</option>
                        <option value="E">east</option>
                        <option value="S">south</option>
                        <option value="W">west</option>
                      </select>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={room.prefs.nearEntrance ?? false}
                        onChange={(e) =>
                          updateRoom(room.id, { prefs: { ...room.prefs, nearEntrance: e.target.checked } })
                        }
                      />
                      near entrance
                    </label>
                  </div>
                </div>
              )}
              {roomViolations.map((v, i) => (
                <p key={i} className={`inline-violation ${v.severity}`}>
                  {v.message}
                </p>
              ))}
            </li>
          );
        })}
      </ul>

      <AdjacencyEditor
        rooms={program.rooms}
        rules={program.adjacency}
        onChange={(adjacency) => update({ adjacency })}
      />

      {(byRoom.get('program') ?? []).map((v, i) => (
        <p key={i} className={`inline-violation ${v.severity}`}>
          {v.message}
        </p>
      ))}
    </div>
  );
}

function AdjacencyEditor({
  rooms,
  rules,
  onChange,
}: {
  rooms: RoomSpec[];
  rules: AdjacencyRule[];
  onChange: (rules: AdjacencyRule[]) => void;
}) {
  const nameOf = (id: string) => rooms.find((r) => r.id === id)?.name ?? '?';
  if (rooms.length < 2) return null;
  return (
    <details className="adjacency">
      <summary>Adjacency wishes ({rules.length})</summary>
      <ul className="rule-list">
        {rules.map((rule, i) => (
          <li key={i} className="row">
            <span className="soft" style={{ flex: 1 }}>
              {nameOf(rule.a)} {rule.kind === 'avoid' ? '↮' : '↔'} {nameOf(rule.b)}
            </span>
            <select
              aria-label="Rule kind"
              value={rule.kind}
              onChange={(e) =>
                onChange(rules.map((r, j) => (j === i ? { ...r, kind: e.target.value as AdjacencyRule['kind'] } : r)))
              }
            >
              <option value="required">must touch</option>
              <option value="preferred">prefer near</option>
              <option value="avoid">keep apart</option>
            </select>
            <button aria-label="Remove rule" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <NewRule rooms={rooms} onAdd={(rule) => onChange([...rules, rule])} />
    </details>
  );
}

function NewRule({ rooms, onAdd }: { rooms: RoomSpec[]; onAdd: (rule: AdjacencyRule) => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  return (
    <div className="row">
      <select aria-label="First room" value={a} onChange={(e) => setA(e.target.value)}>
        <option value="">room…</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <select aria-label="Second room" value={b} onChange={(e) => setB(e.target.value)}>
        <option value="">room…</option>
        {rooms
          .filter((r) => r.id !== a)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </select>
      <button
        disabled={!a || !b}
        onClick={() => {
          onAdd({ a, b, kind: 'preferred', weight: 2 });
          setA('');
          setB('');
        }}
      >
        + wish
      </button>
    </div>
  );
}
