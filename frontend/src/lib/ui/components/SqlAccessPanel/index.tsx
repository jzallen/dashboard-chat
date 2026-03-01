import { useCallback, useEffect, useState } from "react";

import type { SqlAccessStatus } from "@/api";

import {
  useDisableSqlAccess,
  useEnableSqlAccess,
  useRegenerateSqlCredentials,
  useRestartEnvironment,
  useSqlAccessQuery,
  useStartEnvironment,
  useStopEnvironment,
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

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    running: { color: styles.statusRunning, label: "Running" },
    stopped: { color: styles.statusStopped, label: "Stopped" },
    degraded: { color: styles.statusDegraded, label: "Degraded" },
    provisioning: { color: styles.statusProvisioning, label: "Provisioning" },
    error: { color: styles.statusError, label: "Error" },
  };
  const { color, label } = config[status] ?? config.running;
  return (
    <span className={`${styles.statusBadge} ${color}`} data-testid="status-badge">
      {label}
    </span>
  );
}

function LegacyMigrationBanner({ onDisable }: { onDisable: () => void }) {
  return (
    <div className={styles.legacyBanner} data-testid="legacy-banner">
      <div className={styles.legacyIcon}>&#9888;</div>
      <div className={styles.legacyContent}>
        <h3 className={styles.legacyTitle}>SQL Access needs to be reconfigured</h3>
        <p className={styles.legacyDescription}>
          We've upgraded SQL Access to use stable credentials that survive
          environment restarts. Please disable and re-enable SQL Access to get
          your new stable endpoint.
        </p>
        <button className={styles.dangerButton} onClick={onDisable} type="button">
          Disable SQL Access
        </button>
      </div>
    </div>
  );
}

function EnvironmentControls({
  projectId,
  environmentStatus,
  statusMessage,
}: {
  projectId: string;
  environmentStatus: string;
  statusMessage?: string | null;
}) {
  const startMutation = useStartEnvironment();
  const stopMutation = useStopEnvironment();
  const restartMutation = useRestartEnvironment();

  const isPending = startMutation.isPending || stopMutation.isPending || restartMutation.isPending;
  const isRunning = environmentStatus === "running";
  const isStopped = environmentStatus === "stopped";
  const isDegraded = environmentStatus === "degraded";
  const isError = environmentStatus === "error";
  const isProvisioning = environmentStatus === "provisioning";

  return (
    <div className={styles.environmentSection}>
      <div className={styles.environmentHeader}>
        <span className={styles.sectionTitle}>Environment</span>
        <StatusBadge status={environmentStatus} />
      </div>

      {statusMessage && (isDegraded || isError) && (
        <p className={styles.statusMessage}>{statusMessage}</p>
      )}

      {isStopped && (
        <p className={styles.stoppedNote}>
          Environment is stopped. Connection attempts will fail until started.
        </p>
      )}

      <div className={styles.environmentActions}>
        {(isStopped || isError) && (
          <button
            className={styles.primaryButton}
            onClick={() => (isError ? restartMutation : startMutation).mutate(projectId)}
            disabled={isPending || isProvisioning}
            type="button"
          >
            {isPending ? "Starting..." : isError ? "Retry" : "Start"}
          </button>
        )}
        {(isRunning || isDegraded) && (
          <>
            <button
              className={styles.secondaryButton}
              onClick={() => stopMutation.mutate(projectId)}
              disabled={isPending || isProvisioning}
              type="button"
            >
              {stopMutation.isPending ? "Stopping..." : "Stop"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => restartMutation.mutate(projectId)}
              disabled={isPending || isProvisioning}
              type="button"
            >
              {restartMutation.isPending ? "Restarting..." : "Restart"}
            </button>
          </>
        )}
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConnString, setShowConnString] = useState(false);

  const buildConnectionString = () => {
    if (status.connection_string) return status.connection_string;
    if (status.host) return `postgresql://${status.username}@${status.host}:${status.port}/${status.database}`;
    return undefined;
  };
  const connectionString = buildConnectionString();

  const maskedConnString = connectionString
    ? connectionString.replace(/\/\/([^@]+)@/, "//****@")
    : undefined;

  return (
    <>
      <div className={styles.header}>
        <span className={styles.title}>SQL Access</span>
        <StatusBadge status={status.environment_status ?? "running"} />
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
            {showConnString ? connectionString : maskedConnString}
          </span>
          <button
            className={styles.eyeButton}
            onClick={() => setShowConnString(!showConnString)}
            aria-label={showConnString ? "Hide connection string" : "Show connection string"}
            type="button"
          >
            {showConnString ? "\u25C9" : "\u25CE"}
          </button>
          <CopyButton text={connectionString} />
        </div>
      )}

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
          <p className={styles.passwordWarning}>
            Save this password — it won't be shown again
          </p>
        )}
      </div>

      {status.environment_status && (
        <EnvironmentControls
          projectId={status.project_id}
          environmentStatus={status.environment_status}
          statusMessage={status.status_message}
        />
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

/** Manages SQL access lifecycle (enable, disable, sync, credentials) for a project. */
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

  // Legacy migration banner
  if (status.is_legacy) {
    return (
      <div className={styles.container}>
        <LegacyMigrationBanner onDisable={handleDisable} />
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
