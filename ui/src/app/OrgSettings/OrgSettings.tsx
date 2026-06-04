/* Organization settings route page: identity, pipeline defaults, members,
   appearance. */
import type { ReactNode } from "react";

import { catalog } from "../fixtureSource";
import { Icon } from "../primitives";

function Field({ l, v, mono }: { l: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="field">
      <span className="fl">{l}</span>
      <span className={"fv" + (mono ? " mono" : "")}>{v}</span>
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
  const o = catalog.getOrg();
  const initials = (n: string) =>
    n
      .split(" ")
      .map((w) => w[0])
      .slice(0, 2)
      .join("");
  return (
    <div className="org-page">
      <div className="org-head">
        <span className="org-badge">{o.name[0]}</span>
        <div>
          <h1 className="org-title">{o.name}</h1>
          <p className="org-sub">
            {o.plan} plan · {o.usedSeats} of {o.seats} seats used · since{" "}
            {o.created}
          </p>
        </div>
      </div>
      <div className="org-grid">
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
              <div className="member" key={i}>
                <span className="avatar">{initials(m.name)}</span>
                <div className="m-main">
                  <div className="m-name">{m.name}</div>
                  <div className="m-email">{m.email}</div>
                </div>
                <span className="m-role">{m.role}</span>
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
            <div className="appearance-row">
              <div>
                <div className="ap-title">Dark mode</div>
                <div className="ap-sub">
                  Solarized-dark surfaces with brighter, neon-leaning accents.
                </div>
              </div>
              <button
                className={"switch" + (dark ? " on" : "")}
                onClick={onToggleDark}
                role="switch"
                aria-checked={dark}
              >
                <span className="switch-knob" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
