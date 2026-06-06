/* The two non-resolved states a resource route renders while/if the catalog
   doesn't (yet) hold the deep-linked node: a loading skeleton (pending) and a
   not-found panel (the bounded timer elapsed). Mirrors frontend's
   ViewDetailView "Loading…" / "not found" fold, catalog-backed. */

const KIND_LABEL: Record<string, string> = {
  dataset: "dataset",
  view: "view",
  report: "report",
};

export function ModelDetailSkeleton({ kind }: { kind: string }) {
  return (
    <div style={{ padding: 40 }} data-testid="model-detail-skeleton">
      <p style={{ color: "var(--text-500)" }}>
        Loading {KIND_LABEL[kind] ?? "model"}…
      </p>
    </div>
  );
}

export function NodeNotFound({ id, kind }: { id: string; kind: string }) {
  return (
    <div style={{ padding: 40 }} data-testid="node-not-found">
      <h1 className="serif" style={{ fontSize: 22, color: "var(--text-900)" }}>
        {KIND_LABEL[kind] ?? "Model"} not found
      </h1>
      <p style={{ color: "var(--text-500)" }}>
        No {KIND_LABEL[kind] ?? "model"} with id <code>{id}</code> in this
        project.
      </p>
    </div>
  );
}
