import type { Violation } from '../../engine';
import { formatArea } from '../../lib/format';
import { useApp } from '../../state/store';

export function InspectorPanels() {
  const variants = useApp((s) => s.variants);
  const activeVariantId = useApp((s) => s.activeVariantId);
  const solverViolations = useApp((s) => s.solver.violations);
  const unitSystem = useApp((s) => s.unitSystem);
  const program = useApp((s) => s.program);

  const plan = variants.find((v) => v.id === activeVariantId) ?? null;

  if (!plan) {
    return (
      <div className="stack">
        <p className="soft">Generate layouts to see metrics here.</p>
        <ViolationList title="Notes" violations={solverViolations} />
      </div>
    );
  }

  const m = plan.metrics;
  const roomName = (subjectId: string): string => {
    const planRoom = plan.rooms.find((r) => r.id === subjectId);
    if (!planRoom) return '';
    return program.rooms.find((r) => r.id === planRoom.specId)?.name ?? '';
  };

  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Metrics</h3>
      <table className="metrics-table">
        <tbody>
          <tr>
            <td>Gross floor area</td>
            <td>{formatArea(m.grossFloorArea, unitSystem)}</td>
          </tr>
          <tr>
            <td>Rooms total</td>
            <td>{formatArea(m.netRoomArea, unitSystem)}</td>
          </tr>
          <tr>
            <td>Area fit</td>
            <td>{pct(m.areaFitScore)}</td>
          </tr>
          <tr>
            <td>Adjacency wishes</td>
            <td>{pct(m.adjacencyScore)}</td>
          </tr>
          <tr>
            <td>Daylight access</td>
            <td>{pct(m.daylightScore)}</td>
          </tr>
          <tr>
            <td>
              <strong>Overall</strong>
            </td>
            <td>
              <strong>{pct(m.totalScore)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      <ViolationList
        title="This layout"
        violations={plan.violations}
        subjectLabel={roomName}
      />
      <ViolationList title="Generation notes" violations={solverViolations} />
    </div>
  );
}

const pct = (x: number): string => `${Math.round(x * 100)} %`;

function ViolationList({
  title,
  violations,
  subjectLabel,
}: {
  title: string;
  violations: Violation[];
  subjectLabel?: (id: string) => string;
}) {
  if (violations.length === 0) return null;
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>{title}</h3>
      {violations.map((v, i) => (
        <p key={i} className={`inline-violation ${v.severity}`}>
          {subjectLabel && v.subjects[0] ? `${subjectLabel(v.subjects[0])}` : ''} {v.message}
        </p>
      ))}
    </div>
  );
}
