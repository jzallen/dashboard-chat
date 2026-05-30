import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import type { SqlAccessStatus } from "@/dataCatalog";

import {
  useDisableSqlAccess,
  useEnableSqlAccess,
  useRegenerateSqlCredentials,
  useSqlAccessQuery,
  useSyncSqlAccess,
} from "../../hooks/useSqlAccessQuery";
import styles from "./SqlAccessPanel.module.css";

interface SqlAccessPanelProps {
  projectId: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }, [text]);

  return (
    <button
      className={styles.copyButton}
      data-copied={copied}
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy to clipboard"}
      type="button"
    >
      {copied ? "\u2713" : "\u2398"}
    </button>
  );
}

function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <h3 className={styles.dialogTitle}>Disable SQL Access?</h3>
        <p className={styles.dialogDescription}>
          This will drop the project schema and roles from the query engine.
          Active connections will be terminated.
        </p>
        <div className={styles.dialogActions}>
          <button className={styles.secondaryButton} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={styles.dangerButton} onClick={onConfirm} type="button">
            Disable
          </button>
        </div>
      </div>
    </div>
  );
}

function SyncStatusIndicator({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    synced: { color: "#22c55e", label: "Synced" },
    pending: { color: "#f59e0b", label: "Pending" },
    error: { color: "#ef4444", label: "Error" },
  };
  const { color, label } = config[status] ?? config.synced;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: color }} />
      {label}
    </span>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{String(value)}</span>
      <CopyButton text={String(value)} />
    </>
  );
}

function ConnectionDetails({
  status,
  password,
  onSync,
  onRegenerate,
  onDisable,
  isSyncing,
  isRegenerating,
}: {
  status: SqlAccessStatus;
  password: string | null;
  onSync: () => void;
  onRegenerate: () => void;
  onDisable: () => void;
  isSyncing: boolean;
  isRegenerating: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <div className={styles.header}>
        <span className={styles.title}>SQL Access</span>
        {status.engine_node_id && (
          <Link
            to={`/query-engines/${status.engine_node_id}`}
            style={{ fontSize: 13, color: "#2563eb", textDecoration: "none" }}
          >
            View Engine
          </Link>
        )}
      </div>

      <div className={styles.detailsGrid}>
        {status.host && <DetailRow label="Host" value={status.host} />}
        {status.port && <DetailRow label="Port" value={status.port} />}
        {status.database && <DetailRow label="Database" value={status.database} />}
        {status.username && <DetailRow label="Username" value={status.username} />}
        {status.schema && <DetailRow label="Schema" value={status.schema} />}
      </div>

      <div className={styles.section}>
        <div className={styles.passwordRow}>
          <span className={styles.detailLabel}>Password</span>
          {password ? (
            <span className={styles.passwordValue} data-testid="password-value">
              {showPassword ? password : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
              <button
                className={styles.eyeButton}
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                type="button"
              >
                {showPassword ? "\u25C9" : "\u25CE"}
              </button>
              <CopyButton text={password} />
            </span>
          ) : (
            <span className={styles.passwordMasked}>{"••••••••"}</span>
          )}
          <button
            className={styles.secondaryButton}
            onClick={onRegenerate}
            disabled={isRegenerating}
            type="button"
          >
            {isRegenerating ? "Regenerating..." : "Regenerate"}
          </button>
        </div>
        {password && (
          <p className={styles.passwordWarning}>Save this password — it won't be shown again</p>
        )}
      </div>

      {/* Per-dataset sync status */}
      {status.datasets && status.datasets.length > 0 && (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Dataset Sync Status</span>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                <th style={{ padding: "4px 8px", fontWeight: 500, color: "#6b7280" }}>Dataset</th>
                <th style={{ padding: "4px 8px", fontWeight: 500, color: "#6b7280" }}>View</th>
                <th style={{ padding: "4px 8px", fontWeight: 500, color: "#6b7280" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {status.datasets.map((ds: { dataset_id: string; name: string; view_name: string; sync_status: string }) => (
                <tr key={ds.dataset_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "6px 8px" }}>{ds.name}</td>
                  <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{ds.view_name}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <SyncStatusIndicator status={ds.sync_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.syncRow}>
          <span className={styles.syncTimestamp}>
            {status.last_synced_at
              ? `Last synced: ${new Date(status.last_synced_at).toLocaleString()}`
              : "Never synced"}
          </span>
          <button
            className={styles.secondaryButton}
            onClick={onSync}
            disabled={isSyncing}
            type="button"
          >
            {isSyncing ? "Syncing..." : "Force Sync"}
          </button>
        </div>
      </div>

      <div className={styles.actions}>
        <div className={styles.spacer} />
        <button
          className={styles.dangerButton}
          onClick={() => setConfirmOpen(true)}
          type="button"
        >
          Disable SQL Access
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onConfirm={() => {
          setConfirmOpen(false);
          onDisable();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

/** Manages SQL access lifecycle (enable, disable, sync, credentials) for a project. */
export function SqlAccessPanel({ projectId }: SqlAccessPanelProps) {
  const { data: status, isLoading } = useSqlAccessQuery(projectId);
  const enableMutation = useEnableSqlAccess();
  const disableMutation = useDisableSqlAccess();
  const syncMutation = useSyncSqlAccess();
  const regenerateMutation = useRegenerateSqlCredentials();

  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);

  const handleEnable = useCallback(() => {
    setRevealedPassword(null);
    enableMutation.mutate(projectId, {
      onSuccess: (data) => {
        if (data.password) setRevealedPassword(data.password);
      },
    });
  }, [enableMutation, projectId]);

  const handleDisable = useCallback(() => {
    setRevealedPassword(null);
    disableMutation.mutate(projectId);
  }, [disableMutation, projectId]);

  const handleSync = useCallback(() => {
    syncMutation.mutate(projectId);
  }, [syncMutation, projectId]);

  const handleRegenerate = useCallback(() => {
    regenerateMutation.mutate(projectId, {
      onSuccess: (data) => {
        if (data.password) setRevealedPassword(data.password);
      },
    });
  }, [regenerateMutation, projectId]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.spinnerContainer}>
          <div className={styles.spinner} />
          <span className={styles.spinnerText}>Loading...</span>
        </div>
      </div>
    );
  }

  if (enableMutation.isPending) {
    return (
      <div className={styles.container}>
        <div className={styles.spinnerContainer}>
          <div className={styles.spinner} />
          <span className={styles.spinnerText}>Setting up SQL access...</span>
        </div>
      </div>
    );
  }

  if (!status?.enabled) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>SQL Access</p>
          <p className={styles.emptyDescription}>
            Connect to your project data with any PostgreSQL client.
          </p>
          <button className={styles.primaryButton} onClick={handleEnable} type="button">
            Enable SQL Access
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <ConnectionDetails
        status={status}
        password={revealedPassword}
        onSync={handleSync}
        onRegenerate={handleRegenerate}
        onDisable={handleDisable}
        isSyncing={syncMutation.isPending}
        isRegenerating={regenerateMutation.isPending}
      />
    </div>
  );
}
