import { useState, useCallback } from "react";
import {
  useSqlAccessQuery,
  useEnableSqlAccess,
  useDisableSqlAccess,
  useSyncSqlAccess,
  useRegenerateSqlCredentials,
} from "../../hooks/useSqlAccessQuery";
import type { SqlAccessStatus } from "@/api";
import styles from "./SqlAccessPanel.module.css";

interface SqlAccessPanelProps {
  projectId: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          This will terminate all active connections and remove the database.
          This action cannot be undone.
        </p>
        <div className={styles.dialogActions}>
          <button
            className={styles.secondaryButton}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className={styles.dangerButton}
            onClick={onConfirm}
            type="button"
          >
            Disable
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
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

  const connectionString =
    status.connection_string ??
    (status.host
      ? `postgresql://${status.username}@${status.host}:${status.port}/${status.database}`
      : undefined);

  return (
    <>
      <div className={styles.header}>
        <span className={styles.title}>SQL Access</span>
        <span
          className={`${styles.statusBadge} ${styles.statusRunning}`}
          data-testid="status-badge"
        >
          Running
        </span>
      </div>

      <div className={styles.detailsGrid}>
        {status.host && <DetailRow label="Host" value={status.host} />}
        {status.port && <DetailRow label="Port" value={status.port} />}
        {status.database && (
          <DetailRow label="Database" value={status.database} />
        )}
        {status.username && (
          <DetailRow label="Username" value={status.username} />
        )}
        {status.schema && <DetailRow label="Schema" value={status.schema} />}
      </div>

      {connectionString && (
        <div className={styles.connectionString}>
          <span className={styles.connectionStringText}>
            {connectionString}
          </span>
          <CopyButton text={connectionString} />
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.passwordRow}>
          <span className={styles.detailLabel}>Password</span>
          {password ? (
            <span className={styles.passwordValue} data-testid="password-value">
              {password}
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
          <p className={styles.passwordWarning}>
            Save this password — it won't be shown again
          </p>
        )}
      </div>

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
            {isSyncing ? "Syncing..." : "Sync Now"}
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

export function SqlAccessPanel({ projectId }: SqlAccessPanelProps) {
  const { data: status, isLoading } = useSqlAccessQuery(projectId);
  const enableMutation = useEnableSqlAccess();
  const disableMutation = useDisableSqlAccess();
  const syncMutation = useSyncSqlAccess();
  const regenerateMutation = useRegenerateSqlCredentials();

  // Track the password shown after enable/regenerate
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

  // Provisioning state (enable in progress)
  if (enableMutation.isPending) {
    return (
      <div className={styles.container}>
        <div className={styles.spinnerContainer}>
          <div className={styles.spinner} />
          <span className={styles.spinnerText}>Provisioning database...</span>
        </div>
      </div>
    );
  }

  // Disabled or no data
  if (!status?.enabled) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>SQL Access</p>
          <p className={styles.emptyDescription}>
            Connect to your project data with any PostgreSQL client.
          </p>
          <button
            className={styles.primaryButton}
            onClick={handleEnable}
            type="button"
          >
            Enable SQL Access
          </button>
        </div>
      </div>
    );
  }

  // Enabled — show connection details
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
