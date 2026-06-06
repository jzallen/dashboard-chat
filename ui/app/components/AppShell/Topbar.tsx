/* Topbar: org badge + breadcrumb + data-action buttons. Reads location/params
   off the router (replacing the old route.name/route.node atoms) and emits nav
   intents via useNavIntents(). The model breadcrumb is guarded: it only renders
   the ModelPicker once the deep-linked node has resolved (catalog.getNode), so
   a cold deep-link never crashes on a not-yet-loaded node. */
import { useLocation, useNavigate, useParams } from "react-router";

import { useNavIntents } from "../../../app/lib/nav";
import { useProjectId } from "../../../app/lib/useProjectId";
import type { LineageNode } from "../../catalog";
import { ModelPicker, ProjectPicker } from "../Breadcrumb";
import type { ColdStorageApi } from "../ColdStorage";
import type { ExportApi } from "../Export";
import { Icon } from "../primitives";
import type { UploadApi } from "../Upload";
import { catalog } from "../useCatalog";

/** The resource id when the pathname is one of the nested resource-detail
 *  routes (/project/:projectId/{dataset|view|report}/:id), else undefined. */
function modelIdFromPath(
  pathname: string,
  params: Record<string, string | undefined>,
): string | undefined {
  if (pathname.includes("/dataset/")) return params.datasetId;
  if (pathname.includes("/view/")) return params.viewId;
  if (pathname.includes("/report/")) return params.reportId;
  return undefined;
}

export function Topbar({
  upload,
  exporter,
  cold,
  models,
}: {
  upload: UploadApi;
  exporter: ExportApi;
  cold: ColdStorageApi;
  models: LineageNode[];
}) {
  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  const intents = useNavIntents();
  const projectId = useProjectId();

  const projects = catalog.listProjects();
  const projectName = (
    projects.find((p) => p.id === projectId) ?? projects[0]
  )?.name;

  const onOrg = location.pathname === "/org";
  const onChats = location.pathname.endsWith("/chats");
  const onEngines = location.pathname === "/query-engines";
  const modelId = modelIdFromPath(location.pathname, params);
  // Pending guard: the deep-linked node may not be in the catalog yet.
  const currentNode = modelId ? catalog.getNode(modelId) : undefined;

  const coldCount = catalog.listColdStorage().length;
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="breadcrumb">
          <button
            className={"org-badge-btn" + (onOrg ? " on" : "")}
            onClick={intents.toggleOrg}
            title={onOrg ? "Close organization" : "Organization settings"}
          >
            <span className="bd-face bd-d">{catalog.getOrg().name[0]}</span>
            <span className="bd-face bd-x">
              <Icon name="x" size={17} />
            </span>
          </button>
          <div className="bc-rest">
            <span className="brand-sep">/</span>
            {modelId && currentNode ? (
              <>
                <button
                  className="crumb-link"
                  onClick={() =>
                    navigate(projectId ? "/project/" + projectId : "/")
                  }
                >
                  {projectName}
                </button>
                <span className="sep">/</span>
                <ModelPicker
                  current={currentNode}
                  models={models}
                  onSelect={intents.openNode}
                />
              </>
            ) : (
              <>
                <ProjectPicker
                  projectId={projectId ?? ""}
                  onSelect={intents.selectProject}
                />
                {onChats && (
                  <>
                    <span className="sep">/</span>
                    <span className="current">All Chats</span>
                  </>
                )}
                {onEngines && (
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
              onClick={() => navigate("/query-engines")}
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
