// Breadcrumb navigation shell (MR-3, path-forward §4.1).
//
// Transparent floating breadcrumb that replaces the SideNav. Route-context-aware:
//   • list / pipeline views:  OrgIcon / Project ▾            (project picker)
//   • model views:            OrgIcon / Project (link) / Model ▾  (model picker)
// The org icon is a toggle that opens the Org Settings sheet via the `?org=1`
// search param and morphs to an × while open; project-scoped affordances are
// hidden while the org sheet is open. A minimal utility menu keeps New Session,
// All Chats (/sessions), and Query Engines (/query-engines) reachable until the
// assistant overlay (MR-4) absorbs the session controls.
//
// Picker data comes from the existing dataCatalog TanStack Query hooks — the
// ui-state wire is NOT touched (saved-feedback constraint).
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { useChatContext } from "../../context/ChatContext";
import { useDatasetQuery, useDatasets } from "../../hooks/useDatasetQuery";
import { useOrgProjectsQuery } from "../../hooks/useOrgQuery";
import { useReportQuery, useReportsQuery } from "../../hooks/useReportQuery";
import { useViewQuery, useViewsQuery } from "../../hooks/useViewQuery";
import styles from "./Breadcrumb.module.css";
import {
  type ModelKind,
  resolveBreadcrumbContext,
} from "./breadcrumbContext";
import { ModelPicker } from "./ModelPicker";
import { ProjectPicker } from "./ProjectPicker";

type Popover = "project" | "model" | "utility" | null;

const MODEL_ROUTE: Record<ModelKind, string> = {
  dataset: "/table",
  view: "/view",
  report: "/report",
};

interface ModelDetail {
  name?: string;
  project_id?: string;
}

export function Breadcrumb(): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { resetSession } = useChatContext();
  const [openPopover, setOpenPopover] = useState<Popover>(null);

  const context = resolveBreadcrumbContext(params);
  const orgOpen = searchParams.get("org") === "1";

  const viewDetail = useViewQuery(params.viewId).data as ModelDetail | undefined;
  const reportDetail = useReportQuery(params.reportId).data as
    | ModelDetail
    | undefined;
  const datasetDetail = useDatasetQuery(params.datasetId).data as
    | ModelDetail
    | undefined;

  const model =
    context.kind === "model"
      ? context.modelKind === "view"
        ? viewDetail
        : context.modelKind === "report"
          ? reportDetail
          : datasetDetail
      : undefined;

  const activeProjectId = params.projectId ?? model?.project_id ?? null;

  const projects = useOrgProjectsQuery().data ?? [];
  const datasets = useDatasets(activeProjectId ?? undefined).data ?? [];
  const views = useViewsQuery(activeProjectId ?? undefined).data ?? [];
  const reports = useReportsQuery(activeProjectId ?? undefined).data ?? [];

  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );

  function toggleOrg() {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (orgOpen) {
        next.delete("org");
      } else {
        next.set("org", "1");
      }
      return next;
    });
    setOpenPopover(null);
  }

  function selectProject(projectId: string) {
    setOpenPopover(null);
    navigate(`/projects/${projectId}/pipeline`);
  }

  function selectModel(modelKind: ModelKind, modelId: string) {
    setOpenPopover(null);
    navigate(`${MODEL_ROUTE[modelKind]}/${modelId}`);
  }

  function goToUtility(path: string) {
    setOpenPopover(null);
    navigate(path);
  }

  function newSession() {
    setOpenPopover(null);
    resetSession();
    navigate("/");
  }

  return (
    <nav className={styles.bar} aria-label="Breadcrumb">
      <button
        type="button"
        data-testid="breadcrumb-org-icon"
        className={styles.orgIcon}
        aria-label={orgOpen ? "Close org settings" : "Open org settings"}
        onClick={toggleOrg}
      >
        {orgOpen ? "×" : "◆"}
      </button>

      {!orgOpen && context.kind === "list" && (
        <>
          <span className={styles.separator}>/</span>
          <div className={styles.anchor}>
            <button
              type="button"
              data-testid="project-crumb"
              className={styles.crumb}
              onClick={() =>
                setOpenPopover((open) => (open === "project" ? null : "project"))
              }
            >
              {activeProject?.name ?? "Project"} ▾
            </button>
            {openPopover === "project" && (
              <ProjectPicker
                projects={projects}
                currentProjectId={activeProjectId}
                onSelect={selectProject}
              />
            )}
          </div>
        </>
      )}

      {!orgOpen && context.kind === "model" && (
        <>
          <span className={styles.separator}>/</span>
          <Link
            data-testid="project-crumb-link"
            className={styles.crumb}
            to={
              activeProjectId
                ? `/projects/${activeProjectId}/pipeline`
                : "/"
            }
          >
            {activeProject?.name ?? "Project"}
          </Link>
          <span className={styles.separator}>/</span>
          <div className={styles.anchor}>
            <button
              type="button"
              data-testid="model-crumb"
              className={styles.crumb}
              onClick={() =>
                setOpenPopover((open) => (open === "model" ? null : "model"))
              }
            >
              {model?.name ?? "Model"} ▾
            </button>
            {openPopover === "model" && (
              <ModelPicker
                datasets={datasets}
                views={views}
                reports={reports}
                onSelect={selectModel}
              />
            )}
          </div>
        </>
      )}

      <div className={styles.anchor} style={{ marginLeft: "auto" }}>
        <button
          type="button"
          data-testid="breadcrumb-utility"
          className={styles.utility}
          aria-label="Utility menu"
          onClick={() =>
            setOpenPopover((open) => (open === "utility" ? null : "utility"))
          }
        >
          ⋯
        </button>
        {openPopover === "utility" && (
          <div className={styles.picker} role="menu">
            <button
              type="button"
              data-testid="utility-new-session"
              className={styles.option}
              onClick={newSession}
            >
              New Session
            </button>
            <button
              type="button"
              data-testid="utility-sessions"
              className={styles.option}
              onClick={() => goToUtility("/sessions")}
            >
              All Chats
            </button>
            <button
              type="button"
              data-testid="utility-query-engines"
              className={styles.option}
              onClick={() => goToUtility("/query-engines")}
            >
              Query Engines
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

export default Breadcrumb;
