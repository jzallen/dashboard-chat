/* Topbar: org badge + breadcrumb + data-action buttons. */
import type { LineageNode } from "../../lib/catalog";
import { ModelPicker, ProjectPicker } from "../Breadcrumb";
import type { ColdStorageApi } from "../ColdStorage";
import type { ExportApi } from "../Export";
import { Icon } from "../primitives";
import type { UploadApi } from "../Upload";
import { catalog } from "../useCatalog";
import type { NavApi } from "./useNavigation";

export function Topbar({
  nav,
  upload,
  exporter,
  cold,
  models,
}: {
  nav: NavApi;
  upload: UploadApi;
  exporter: ExportApi;
  cold: ColdStorageApi;
  models: LineageNode[];
}) {
  const { route } = nav;
  const coldCount = catalog.listColdStorage().length;
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="breadcrumb">
          <button
            className={"org-badge-btn" + (route.name === "org" ? " on" : "")}
            onClick={nav.toggleOrg}
            title={
              route.name === "org"
                ? "Close organization"
                : "Organization settings"
            }
          >
            <span className="bd-face bd-d">{catalog.getOrg().name[0]}</span>
            <span className="bd-face bd-x">
              <Icon name="x" size={17} />
            </span>
          </button>
          <div className="bc-rest">
            <span className="brand-sep">/</span>
            {route.name === "model" ? (
              <>
                <button
                  className="crumb-link"
                  onClick={() => nav.setRoute({ name: "workspace" })}
                >
                  {nav.projectName}
                </button>
                <span className="sep">/</span>
                <ModelPicker
                  current={route.node!}
                  models={models}
                  onSelect={nav.openModel}
                />
              </>
            ) : (
              <>
                <ProjectPicker
                  projectId={nav.projectId}
                  onSelect={nav.selectProject}
                />
                {route.name === "chats" && (
                  <>
                    <span className="sep">/</span>
                    <span className="current">All Chats</span>
                  </>
                )}
                {route.name === "engines" && (
                  <>
                    <span className="sep">/</span>
                    <span className="current">Query Engines</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          <div className="icon-group nolead">
            <button
              className="icon-btn"
              title="Upload a source"
              onClick={() => upload.openUpload(null)}
            >
              <Icon name="upload" />
            </button>
            <button
              className="icon-btn"
              title="Export dbt project"
              onClick={exporter.openExport}
            >
              <Icon name="download" />
            </button>
            <button
              className="icon-btn"
              title="Query engines"
              onClick={() => nav.setRoute({ name: "engines" })}
            >
              <Icon name="database" />
            </button>
            <button
              className="icon-btn cold-btn-toolbar"
              title="Cold storage"
              onClick={cold.openCold}
            >
              <Icon name="fridge" />
              {coldCount > 0 && <span className="cold-count">{coldCount}</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
