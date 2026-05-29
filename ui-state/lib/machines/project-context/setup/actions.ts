// Actions for the project-context statechart — the ONLY writers of machine
// context. Each is a bare closure, param-annotated with the shared `ActionArgs`
// alias (./types.ts); the `assign(...)` wrap happens at the `setup()` call in
// ../machine.ts, where inference flows from `setup`'s `types` — no xstate
// generics are pinned here. `tagCause` is the one parameterized action — it reads
// its cause tag from a 2nd `params` arg (the proven collapse of the five
// constant-tag assigns).
//
// `event` is the FULL declared event union for EVERY action: `setup` types each
// named action's expression-event as the whole `TEvent`, regardless of which
// transition references it. Events that carry a specific payload narrow on
// `event.type`; done events from invoked actors are NOT members, so the
// actor-result readers cast `event` to reach `.output`.

import { validateProjectName } from "./domain.ts";
import type {
  ActionArgs,
  ProjectContextCauseTag,
  ProjectSummary,
} from "./types.ts";

/** open_deep_link (root handler): capture the URL wish into the `deeplink_*`
 *  fields. `intent_resource_*` is NOT materialized here — the orchestrator
 *  forwards it from the event payload straight into `project_ready`. */
export const captureDeepLinkWish = ({ event, context }: ActionArgs) => {
  if (event.type !== "open_deep_link") return {};
  return {
    deeplink_project_id: event.intent_project_id ?? context.deeplink_project_id,
    deeplink_session_id: event.intent_session_id ?? context.deeplink_session_id,
  };
};

/** auth_ready: inherit org_id + user.first_name from J-001's projection so this
 *  machine never re-fetches them from JWT / /api/orgs/me (DWD-6, F-5). */
export const assignAuthReady = ({ event }: ActionArgs) => {
  if (event.type !== "auth_ready") return {};
  return {
    org_id: event.org_id,
    user: { first_name: event.user.first_name },
  };
};

/** resolveInitialScope onDone (settle): land the picked project plus the
 *  last-used observability payload (the most-recent-session map and the degraded
 *  set the orchestrator reads on settle). */
export const assignResolvedScope = ({ event, context }: ActionArgs) => {
  const out = (
    event as unknown as {
      output: {
        project: ProjectSummary;
        most_recent_session_per_project?: Record<string, string>;
        degraded_project_ids?: string[];
      };
    }
  ).output;
  return {
    project: { id: out.project.id, name: out.project.name },
    most_recent_session_per_project:
      out.most_recent_session_per_project ??
      context.most_recent_session_per_project,
    last_used_degraded_project_ids: out.degraded_project_ids ?? [],
  };
};

/** createProject onDone: land the created project on context. */
export const assignCreatedProject = ({ event }: ActionArgs) => {
  const out = (event as unknown as { output: ProjectSummary }).output;
  return { project: { id: out.id, name: out.name } };
};

/** project_selected → switching_project: capture the switch target as the
 *  deep-link wish the switchProject invoke reads. */
export const captureSwitchTarget = ({ event }: ActionArgs) => ({
  deeplink_project_id:
    event.type === "switching_project_intent" ? event.new_project_id : null,
});

/** switchProject onDone (settle): land the new project, clear the settled
 *  deep-link wish + cause, and bump the scope-reconciled counter. */
export const assignSwitchedProject = ({ event, context }: ActionArgs) => {
  const out = (event as unknown as { output: { project: ProjectSummary } })
    .output;
  return {
    project: { id: out.project.id, name: out.project.name },
    // Clear the deeplink wish — settled.
    deeplink_project_id: null,
    deeplink_session_id: null,
    underlying_cause_tag: null,
    scope_reconciled_count: context.scope_reconciled_count + 1,
  };
};

/** scope_mismatch_terminal → resolving_initial_scope: clear the deep-link wish
 *  and the mismatch cause so the resolver re-runs clean. */
export const clearScopeMismatch = () => ({
  deeplink_project_id: null,
  deeplink_session_id: null,
  underlying_cause_tag: null,
});

/** error_recoverable → creating_project: clear the transient cause and bump the
 *  retry counter (pending_project_name is preserved untouched). */
export const clearErrorAndBumpRetries = ({ context }: ActionArgs) => ({
  underlying_cause_tag: null,
  retries_count: context.retries_count + 1,
});

/** Parameterized: ONE "set the cause tag" action, configured per transition via
 *  `params` (XState's recommended way to keep an action event-agnostic). The 2nd
 *  `params` arg carries the per-transition tag — `assign(tagCause)` at the
 *  setup() site infers TParams from this annotation. The tag string VALUES are
 *  wire-frozen (projected); only the call site changes. */
export const tagCause = (_: ActionArgs, params: { tag: ProjectContextCauseTag }) => ({
  underlying_cause_tag: params.tag,
});

/** Invalid create_project_submitted: record the inline validation error so the
 *  no_projects surface shows it. */
export const recordProjectValidationError = ({ event }: ActionArgs) => {
  if (event.type !== "create_project_submitted") {
    return { project_validation_error: null };
  }
  return { project_validation_error: validateProjectName(event.org_name) };
};

/** Valid create_project_submitted: clear any prior inline error. */
export const clearProjectValidationError = () => ({
  project_validation_error: null,
});

/** Valid create_project_submitted: preserve the trimmed composer text across
 *  creating_project ↔ error_recoverable. */
export const capturePendingProjectName = ({ event, context }: ActionArgs) => {
  if (event.type !== "create_project_submitted") {
    return { pending_project_name: context.pending_project_name };
  }
  return { pending_project_name: event.org_name.trim() };
};
