/**
 * metadataApiSource — the backend-backed {@link PartialCatalogSource} for the
 * catalog's WRITE ports. Every read is now seeded server-side (the app-shell +
 * `/project/:projectId` loaders fetch through `apiFetch` and hydrate the catalog
 * via `seedOrgGlobal`/`seedProjectScoped`), so this source no longer reads the
 * backend from the browser at all — the browser reaches the backend ONLY through
 * the same-origin `/ui-server/*` gateway.
 *
 * Each write goes same-origin to a `/ui-server/*` action (via
 * {@link import("../../lib/gateway-client")}), which forwards to the backend
 * through auth-proxy server-side. The one exception is {@link putToStorage}: the
 * presigned bytes PUT is a direct browser→object-storage call (no `/api`, no
 * auth-proxy) — the single allowed non-gateway request.
 *
 * Scoping: the active project id is injected via `deps.getProjectId` (like
 * `deps.getToken`) so the catalog stays router-free. Project-scoped writes read it
 * synchronously — the `/project/:projectId` layout loader has always run
 * `selectProject` before any write can fire, so no pre-paint fallback is needed.
 *
 * Failure contract: a non-2xx REJECTS (gatewayPatch/Post/Upload throw), so the
 * catalog's optimistic write-through rolls back.
 */
import { gatewayPatch, gatewayPost, gatewayUpload } from "../../lib/gateway-client";
import type { ModelKind } from "../lineage";
import type { PartialCatalogSource } from "./source";

/** Dependencies the source needs from the app — kept minimal and injected. */
export interface MetadataApiSourceDeps {
  /** Returns the current auth token (or null when unauthenticated). Retained as
   *  an ignored seam (auth rides the httpOnly session cookie now); callers still
   *  pass one but it never reaches the wire. */
  getToken: () => string | null;
  /**
   * Returns the currently scoped project id (the `/project/:projectId` path
   * segment), or undefined before the layout loader has run `selectProject`.
   * Injected like {@link getToken} so the catalog stays router-free.
   */
  getProjectId?: () => string | undefined;
}

/**
 * Read the server-assigned id off a JSON:API single response `{ data: { id } }`.
 * Used by the write ports that go through `gatewayPost` — which returns the RAW
 * decoded body (it does NOT envelope-unwrap), so the id is pulled out here.
 */
function dataId(body: unknown): string {
  const data = (body as { data?: { id?: unknown } } | undefined)?.data;
  return String(data?.id);
}

export function metadataApiSource(
  deps: MetadataApiSourceDeps,
): PartialCatalogSource {
  /**
   * The scoped project id for a project-scoped write. The layout loader runs
   * `selectProject` before any write can fire, so the injected id is always
   * present here; a missing id is a programmer error, not a pre-paint instant.
   */
  const requireProjectId = (): string => {
    const pid = deps.getProjectId?.();
    if (!pid) {
      throw new Error("No scoped project id for a project-scoped write");
    }
    return pid;
  };

  return {
    async toggleAuditEntry(
      auditEntryId: string,
      enabled: boolean,
    ): Promise<void> {
      // PATCH the project-scoped audit entry through the ui-server action. The
      // backend resolves the transform via the reversed FK and flips its status
      // (recompiling the staging SQL on read). Rejects on a non-2xx so the catalog
      // rolls back its optimistic flip.
      const pid = requireProjectId();
      await gatewayPatch(
        `/ui-server/projects/${encodeURIComponent(pid)}/audit/${encodeURIComponent(auditEntryId)}`,
        { enabled },
      );
    },

    async renameModel(
      id: string,
      kind: ModelKind,
      name: string,
    ): Promise<void> {
      // A dataset's editable display label is `display_name` (its `name` is the
      // immutable upload filename); views and reports rename `name` directly.
      // Datasets are addressed org-globally; views/reports are project-scoped.
      // Each write goes through the same-origin ui-server action; rejects on a
      // non-2xx so the catalog rolls back.
      if (kind === "dataset") {
        await gatewayPatch(`/ui-server/datasets/${encodeURIComponent(id)}`, {
          display_name: name,
        });
        return;
      }
      const pid = requireProjectId();
      const collection = kind === "view" ? "views" : "reports";
      await gatewayPatch(
        `/ui-server/projects/${encodeURIComponent(pid)}/${collection}/${encodeURIComponent(id)}`,
        { name },
      );
    },

    async setModelName(id: string, modelName: string): Promise<void> {
      // A dataset's dbt machine name is `model_name` — DECOUPLED from the
      // `display_name` that `renameModel` edits. PATCH it on its own through the
      // ui-server action so a machine-name change never disturbs the display
      // label. The backend normalizes (`stg_<snake>`), rejects collisions (409),
      // and repoints the live warehouse view. Rejects on a non-2xx so the caller
      // surfaces the error (no optimistic flip to roll back).
      await gatewayPatch(`/ui-server/datasets/${encodeURIComponent(id)}`, {
        model_name: modelName,
      });
    },

    async archiveModel(id: string, kind: ModelKind): Promise<void> {
      // Only datasets support a restorable soft-delete (archived_at + retention);
      // views/reports have hard-delete only, so archiving them is left local-only
      // (no backend op). The soft-delete goes same-origin to the ui-server action
      // (`POST /ui-server/datasets/{id}/archive`), which forwards to the backend
      // server-side. Rejects on a non-2xx so the catalog restores the
      // optimistically-hidden node.
      if (kind !== "dataset") return;
      await gatewayPost(
        `/ui-server/datasets/${encodeURIComponent(id)}/archive`,
      );
    },

    async restoreModel(id: string, kind: ModelKind): Promise<void> {
      if (kind !== "dataset") return;
      await gatewayPost(
        `/ui-server/datasets/${encodeURIComponent(id)}/restore`,
      );
    },

    async createDataset(file: File): Promise<{ id: string }> {
      // One-step multipart upload brokered same-origin through the ui-server
      // action (`POST /ui-server/uploads`), which forwards the multipart body to
      // the backend `/api/uploads` server-side through auth-proxy — NOT a
      // browser-direct `/api` call. The backend writes the raw file to the data
      // lake (minio), creates the dataset (parquet + schema inference), and emits
      // the upload outbox event — returning the created dataset. Rejects on a
      // non-2xx (gatewayUpload throws) so the caller can surface the failure.
      const pid = requireProjectId();
      const form = new FormData();
      form.append("file", file);
      form.append("project_id", pid);
      const res = await gatewayUpload<{ data: { id: string } }>(
        "/ui-server/uploads",
        form,
      );
      return { id: res.data.id };
    },

    /* ─── Source-from-upload saga ports ──────────────────────────────────── */

    async createSource(name: string): Promise<{ id: string }> {
      // The saga's source-create write goes same-origin to the ui-server action
      // (`POST /ui-server/sources`), which forwards `{project_id, name}` to the
      // backend `/api/sources` server-side through auth-proxy and passes the 201
      // JSON:API single body straight back. gatewayPost returns the RAW body (no
      // unwrap), so the id is read off `data.id`. Rejects on a non-2xx so the saga
      // reports failure.
      const pid = requireProjectId();
      const body = await gatewayPost<{ data: { id: string } }>(
        "/ui-server/sources",
        { project_id: pid, name },
      );
      return { id: dataId(body) };
    },

    async requestUpload(
      sourceId: string,
      file: File,
    ): Promise<{ uploadId: string; putUrl: string; storageKey: string }> {
      // The presign-mint write goes same-origin to the ui-server action
      // (`POST /ui-server/sources/{id}/uploads`), which forwards
      // {filename, content_type, size} to the backend server-side and passes the
      // 202 RAW body (NOT JSON:API): {upload_id, put_url, storage_key, status}
      // straight back. The browser uploads the bytes itself via putToStorage —
      // only that presigned PUT stays a direct browser→storage call (no bytes
      // here).
      const body = await gatewayPost<{
        upload_id: string;
        put_url: string;
        storage_key: string;
        status: string;
      }>(`/ui-server/sources/${encodeURIComponent(sourceId)}/uploads`, {
        filename: file.name,
        content_type: file.type,
        size: file.size,
      });
      return {
        uploadId: body.upload_id,
        putUrl: body.put_url,
        storageKey: body.storage_key,
      };
    },

    async putToStorage(putUrl: string, file: File): Promise<void> {
      // DIRECT browser → MinIO PUT. Plain fetch, NOT through the app/auth-proxy:
      // no session cookie, no Authorization header. The presign was signed with
      // a ContentType, so the PUT MUST echo `Content-Type: file.type` or MinIO
      // rejects the signature. Rejects on a non-2xx storage response. This is the
      // one allowed non-gateway browser request.
      const response = await fetch(putUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!response.ok) {
        throw new Error(`PUT to storage failed with status ${response.status}`);
      }
    },

    async processUpload(
      sourceId: string,
      uploadId: string,
      choices?: Record<string, unknown>,
    ): Promise<{ datasetId: string }> {
      // The process write goes same-origin to the ui-server action
      // (`POST /ui-server/sources/{id}/uploads/{id}/process`), which forwards to
      // the backend `.../process` server-side and passes its 200 JSON:API
      // datasets body (the linked/appended staging Dataset) — and any non-2xx —
      // straight back. gatewayPost returns the RAW body, so the id is read off
      // `data.id`. A 4xx throws (with the body) — notably a 422 SchemaMismatch
      // (whose byte-intact missing/extra/type_mismatch detail the saga reports as
      // source_upload_failed and the surface renders as a recovery affordance).
      const body = await gatewayPost<{ data: { id: string } }>(
        `/ui-server/sources/${encodeURIComponent(sourceId)}/uploads/${encodeURIComponent(uploadId)}/process`,
        choices ? { choices } : undefined,
      );
      return { datasetId: dataId(body) };
    },
  };
}
