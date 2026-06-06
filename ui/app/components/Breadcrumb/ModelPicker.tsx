/* Breadcrumb model switcher: a searchable dropdown of the project's models,
   grouped by layer. */
import { Fragment, useState } from "react";

import type { Layer, LineageNode } from "../../catalog";
import { LAYER_META } from "../layerMeta";
import { Icon, type IconName, LayerDot } from "../primitives";

export function ModelPicker({
  current,
  models,
  onSelect,
}: {
  current: LineageNode;
  models: LineageNode[];
  onSelect: (model: LineageNode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const list = models.filter((m) =>
    (m.label + " " + m.sub + " " + (LAYER_META[m.layer]?.name || ""))
      .toLowerCase()
      .includes(ql),
  );
  const groups: [Layer, IconName][] = [
    ["staging", "database"],
    ["intermediate", "join"],
    ["mart", "layers"],
  ];
  return (
    <div className="proj-picker">
      <button className="model-btn" onClick={() => setOpen((o) => !o)}>
        <span>{current.label}</span>
        <Icon name="chevD" size={14} />
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
                placeholder="Search datasets, views, reports…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="proj-list">
              {groups.map(([ly, ic]) => {
                const items = list.filter((m) => m.layer === ly);
                if (!items.length) return null;
                return (
                  <Fragment key={ly}>
                    <div className="pick-group">
                      <LayerDot layer={ly} size={7} />
                      {LAYER_META[ly].name}
                    </div>
                    {items.map((m) => (
                      <button
                        key={m.id}
                        className={
                          "proj-row" +
                          (m.id === current.id ? " on" : "") +
                          " layer-" +
                          m.layer
                        }
                        onClick={() => {
                          onSelect(m);
                          setOpen(false);
                          setQ("");
                        }}
                      >
                        <span className="proj-ic lyr">
                          <Icon name={ic} size={15} />
                        </span>
                        <span className="proj-meta">
                          <span className="proj-nm mono">{m.label}</span>
                          <span className="proj-ds">{m.sub}</span>
                        </span>
                      </button>
                    ))}
                  </Fragment>
                );
              })}
              {list.length === 0 && (
                <div
                  style={{
                    padding: 14,
                    fontSize: 13,
                    color: "var(--text-400)",
                    textAlign: "center",
                  }}
                >
                  No models match.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
