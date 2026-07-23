/* Breadcrumb project switcher: a searchable dropdown of the org's projects. */
import { useState } from "react";

import type { ProjectSummary } from "../../catalog";
import { Icon } from "../primitives";
import { useCatalogWithSelector } from "../useCatalog";

export function ProjectPicker({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect: (project: ProjectSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Re-render only when the project list changes, so a project rename/add lands
  // here even when no ancestor re-renders — and a lineage/audit commit does not.
  const projects = useCatalogWithSelector((s) => s.projects);
  const cur = projects.find((p) => p.id === projectId) || projects[0];
  const list = projects.filter((p) =>
    (p.name + " " + p.desc).toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="proj-picker">
      <button className="proj-btn" onClick={() => setOpen((o) => !o)}>
        {/* Empty-org: no current project yet (onboarding state). */}
        {cur?.name ?? "No project"}
        <Icon name="chevD" size={15} />
      </button>
      {open && (
        <>
          <div
            className="proj-scrim"
            onClick={() => {
              setOpen(false);
              setQ("");
            }}
          />
          <div className="proj-pop">
            <div className="proj-search">
              <Icon name="search" size={15} />
              <input
                placeholder="Search projects…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="proj-list">
              {list.map((p) => (
                <button
                  key={p.id}
                  className={"proj-row" + (p.id === cur.id ? " on" : "")}
                  onClick={() => {
                    onSelect(p);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <span className="proj-ic">
                    <Icon name="folder" size={16} />
                  </span>
                  <span className="proj-meta">
                    <span className="proj-nm">{p.name}</span>
                    <span className="proj-ds">{p.desc}</span>
                  </span>
                  <span className="proj-ct">{p.models} models</span>
                </button>
              ))}
              {list.length === 0 && (
                <div
                  style={{
                    padding: 14,
                    fontSize: 13,
                    color: "var(--text-400)",
                    textAlign: "center",
                  }}
                >
                  No projects match.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
