import { useEffect, useState } from 'react';
import type { ProjectMeta, QuarantineMeta } from '../../db/projectRepo';
import { dateStamp, downloadText, safeFilename } from '../../lib/download';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  newProject,
  openProject,
  rawQuarantined,
} from './projectService';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProjectListDialog({ open, onClose }: Props) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [quarantined, setQuarantined] = useState<QuarantineMeta[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const refresh = () => {
    void listProjects().then((r) => {
      setProjects(r.projects);
      setQuarantined(r.quarantined);
    });
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  if (!open) return null;

  return (
    <div className="overlay" role="dialog" aria-label="Projects">
      <div className="dialog">
        <div className="dialog-head">
          <strong>Projects</strong>
          <span style={{ flex: 1 }} />
          <button
            className="primary"
            onClick={() => {
              void newProject().then(onClose);
            }}
          >
            New project
          </button>
          <button onClick={onClose}>Close</button>
        </div>
        {projects.length === 0 && <p style={{ color: 'var(--ink-soft)' }}>No projects yet.</p>}
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                className="project-open"
                onClick={() => {
                  void openProject(p.id).then((ok) => ok && onClose());
                }}
              >
                <span>{p.name}</span>
                <span className="soft">{new Date(p.modifiedAt).toLocaleString()}</span>
              </button>
              <button title="Duplicate" onClick={() => void duplicateProject(p.id).then(refresh)}>
                ⧉
              </button>
              {confirmingDelete === p.id ? (
                <button
                  className="danger"
                  onClick={() => {
                    setConfirmingDelete(null);
                    void deleteProject(p.id).then(refresh);
                  }}
                >
                  Really delete?
                </button>
              ) : (
                <button title="Delete" onClick={() => setConfirmingDelete(p.id)}>
                  🗑
                </button>
              )}
            </li>
          ))}
        </ul>
        {quarantined.length > 0 && (
          <>
            <h4>Unrecoverable</h4>
            <ul className="project-list">
              {quarantined.map((q) => (
                <li key={q.id}>
                  <span className="soft" style={{ flex: 1 }}>
                    {q.id} — {q.reason.slice(0, 80)}
                  </span>
                  <button
                    onClick={() => {
                      void rawQuarantined(q.id).then((raw) => {
                        if (raw) downloadText(raw, `${safeFilename(q.id)}-${dateStamp()}-raw.json`, 'application/json');
                      });
                    }}
                  >
                    Download raw
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
