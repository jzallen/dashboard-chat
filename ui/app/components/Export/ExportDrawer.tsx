/* dbt export drawer: the project's dbt model tree grouped by layer, with any
   live-created marts injected. */
import type { DbtFile, Layer } from "../../catalog";
import { Icon, LayerDot } from "../primitives";
import { catalog } from "../useCatalog";
import styles from "./Export.module.css";

/** A dbt file, plus a flag marking marts created live in this session. */
type ExportFile = DbtFile & { live?: boolean };

export function ExportDrawer({ onClose }: { onClose: () => void }) {
  const files: ExportFile[] = catalog.listDbtFiles().slice();
  // inject any live-created marts
  catalog.listAddedNodes().forEach((n) => {
    if (n.layer === "mart")
      files.push({
        path: `models/marts/${n.label}.sql`,
        layer: "mart",
        ref: n.id,
        live: true,
      });
  });
  const groups: { key: Layer | "config"; name: string; dbt: string }[] = [
    { key: "config", name: "Project", dbt: "dbt_project.yml" },
    { key: "staging", name: "Staging", dbt: "models/staging · stg_" },
    {
      key: "intermediate",
      name: "Intermediate",
      dbt: "models/intermediate · int_",
    },
    { key: "mart", name: "Marts", dbt: "models/marts · fct_ / dim_" },
  ];
  return (
    <>
      <div className={styles.drawerScrim} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHd}>
          <Icon name="download" size={20} style={{ color: "var(--primary)" }} />
          <span className={styles.dt}>Export dbt project</span>
          <button
            className="icon-btn"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className={styles.drawerBody}>
          <p className={styles.expIntro}>
            Every layer maps to a dbt model folder. Datasets compile to{" "}
            <code>staging</code>, Views to <code>intermediate</code>, and
            Reports to <code>marts</code> — with <code>ref()</code> wiring the
            lineage and an auto-generated <code>schema.yml</code>.
          </p>
          {groups.map((g) => {
            const fs = files.filter((f) => f.layer === g.key);
            return (
              <div key={g.key} className={"layer-" + g.key}>
                <div className={styles.layerHead}>
                  <LayerDot layer={g.key === "config" ? "source" : g.key} />
                  <span className={styles.lhn}>{g.name}</span>
                  <span className={styles.lhc}>{g.dbt}</span>
                </div>
                <div className={styles.tree}>
                  {fs.map((f, i) => (
                    <div className={`${styles.treeFile} layer-${f.layer}`} key={i}>
                      <span className={styles.fl} />
                      {f.path.split("/").pop()}
                      {f.ref && (
                        <span className={styles.fmodel}>
                          {f.live
                            ? "✨ new"
                            : catalog.getNode(f.ref)?.label || ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.drawerFt}>
          <span className={styles.ds}>
            {files.length} files ·{" "}
            {catalog
              .getCurrentProject()
              .name.toLowerCase()
              .replace(/\s+/g, "_")}
            .zip
          </span>
          <button
            className="btn primary sq"
            style={{ marginLeft: "auto" }}
            onClick={onClose}
          >
            <Icon name="download" size={15} />
            Download .zip
          </button>
        </div>
      </div>
    </>
  );
}
