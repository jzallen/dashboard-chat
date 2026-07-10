/* The "uploading" view: the simulated three-leg dial-up progress bars. Purely
   presentational — it renders the leg/pct state the upload saga produces. */
import { Icon } from "../primitives";
import styles from "./Upload.module.css";
import { LEG_DEFS } from "./useUploadProgress";

/** Renders the connection-progress legs for the given active leg and percent. */
export function UploadingView({
  leg,
  pct,
  overallPct,
}: {
  leg: number;
  pct: number;
  overallPct: number;
}) {
  return (
    <div className={styles.legs}>
      <div className={styles.legStatus}>
        Connecting to query engine — <b>{overallPct}%</b>
      </div>
      {LEG_DEFS.map((L, i) => {
        const state = leg > i ? "done" : leg === i ? "active" : "";
        const w = leg > i ? 100 : leg === i ? pct : 0;
        return (
          <div className={`${styles.leg} ${styles[state] ?? ""}`} key={L.key}>
            <span className={styles.legName}>
              <span className={styles.legDot} />
              {L.name}
            </span>
            <span className={styles.legTrack}>
              <span className={styles.legFill} style={{ width: w + "%" }} />
            </span>
            <span className={styles.legPercent}>{w}%</span>
          </div>
        );
      })}
      <div className={styles.legsFooter}>
        <Icon name="database" size={12} />
        duckdb · local engine
      </div>
    </div>
  );
}
