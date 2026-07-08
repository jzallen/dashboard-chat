/* Organization settings route page: identity, pipeline defaults, members,
   appearance. */
import type { ReactNode } from "react";

import { Icon } from "../primitives";
import { useCatalogContext } from "../useCatalog";
import styles from "./OrgSettings.module.css";

function Field({ l, v, mono }: { l: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className={styles.field}>
      <span className={styles.fl}>{l}</span>
      <span className={`${styles.fv}${mono ? " mono" : ""}`}>{v}</span>
    </div>
  );
}

export function OrgSettings({
  dark,
  onToggleDark,
}: {
  dark: boolean;
  onToggleDark: () => void;
}) {
  const catalog = useCatalogContext();
  const o = catalog.getOrg();
  const initials = (n: string) =>
    n
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("");
  return (
    <div className={styles.orgPage}>
      <div className={styles.orgHead}>
        <span className={styles.orgBadge}>{o.name[0]}</span>
        <div>
          <h1 className={styles.orgTitle}>{o.name}</h1>
          <p className={styles.orgSub}>
            {o.plan} plan · {o.usedSeats} of {o.seats} seats used · since{" "}
            {o.created}
          </p>
        </div>
      </div>
      <div className={styles.orgGrid}>
        <div className="panel">
          <div className="panel-hd">
            <Icon name="gear" size={15} style={{ color: "var(--text-500)" }} />
            <span className="pt">General</span>
          </div>
          <div className="panel-body">
            <Field l="Organization name" v={o.name} />
            <Field l="Workspace URL" v={"dashboardchat.io/" + o.slug} mono />
            <Field l="Compute region" v={o.region} mono />
            <Field l="Plan" v={o.plan} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-hd">
            <Icon
              name="database"
              size={15}
              style={{ color: "var(--text-500)" }}
            />
            <span className="pt">Pipeline defaults</span>
          </div>
          <div className="panel-body">
            <Field l="Query engine" v={o.defaults.engine} mono />
            <Field
              l="Default materialization"
              v={o.defaults.materialization}
              mono
            />
            <Field l="dbt model prefix" v={o.defaults.modelPrefix + "_"} mono />
          </div>
        </div>
        <div className="panel spanfull">
          <div className="panel-hd">
            <Icon name="chat" size={15} style={{ color: "var(--text-500)" }} />
            <span className="pt">Members</span>
            <span className="pcount">
              {o.usedSeats} of {o.seats} seats
            </span>
          </div>
          <div className="panel-body">
            {o.members.map((m, i) => (
              <div className={styles.member} key={i}>
                <span className={styles.avatar}>{initials(m.name)}</span>
                <div className={styles.mMain}>
                  <div className={styles.mName}>{m.name}</div>
                  <div className={styles.mEmail}>{m.email}</div>
                </div>
                <span className={styles.mRole}>{m.role}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel spanfull">
          <div className="panel-hd">
            <Icon
              name="sparkle"
              size={15}
              style={{ color: "var(--text-500)" }}
            />
            <span className="pt">Appearance</span>
          </div>
          <div className="panel-body">
            <div className={styles.appearanceRow}>
              <div>
                <div className={styles.apTitle}>Dark mode</div>
                <div className={styles.apSub}>
                  Solarized-dark surfaces with brighter, neon-leaning accents.
                </div>
              </div>
              <button
                className={`${styles.switch}${dark ? " " + styles.on : ""}`}
                onClick={onToggleDark}
                role="switch"
                aria-checked={dark}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
