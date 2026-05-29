# Refactor plan — bring `project-context` + `session-chat` to canonical `setup/` shape

**Wave:** REVIEW (analysis + plan only — this document changes no source)
**Branch:** `review/pc-sc-setup-parity`
**Reviewer verdict:** `NEEDS_REVISION` against the canonical shape — both machines are
monolithic `machine.ts` files that inline their actors, guards, and actions. Neither
has a `setup/` directory. They are the last two machines in `ui-state/lib/machines/`
not yet converted.
**Divergence grade:** project-context **C** (one `validation.ts` already split out, a
small named-action seam already exists; ~340 LOC of statechart + ~355 LOC of actor
factories still inline). session-chat **D** (1392 LOC monolith, nothing split, 25
inline `assign`s, 10 inline guards, ~488 LOC of actor factories, and near-duplicate
`project_ready` reset blocks copied across 4 states).

---

## 1. Executive summary

- **project-context** (`machine.ts` 879 LOC) is the smaller, cleaner target. It already
  has a `validation.ts` sibling and three named actions in `setup({ actions })`, but the
  bulk of its writes are **19 inline `assign`s** and **5 inline guards** buried in the
  statechart, and **~355 LOC of production actor factories** share the file. → **1 MR**,
  end-state `machine.ts` ≈ **260 LOC** (can't hit the ~190 benchmark — it has 7 states and
  more transition branches than onboarding; see §A.5).

- **session-chat** (`machine.ts` 1392 LOC) is the larger, riskier target: **25 inline
  `assign`s**, **10 inline guards**, **4 production actor factories (~488 LOC)**, and a
  `project_ready` context-reset block **copy-pasted into 4 states** with subtle per-state
  differences. → **2 MRs** (types+actors, then guards+actions+collapse), end-state
  `machine.ts` ≈ **360 LOC** (9 states; ~190 is not realistic — see §B.5).

- **Recommended sequencing:** do **project-context first** (it is the proving ground for
  the deps-driven `buildActors` type-pinning trick that session-chat then reuses), then
  session-chat. They are independent machines with **zero file overlap**, but both touch
  the shared `ui-state` test run, so land them **sequentially** through the merge queue to
  keep each gate green and each diff reviewable. ~**3 MRs total**.

- **Both are wire-frozen.** Every external consumer imports through the `index.ts` barrel
  (`../project-context/index.ts`, `../session-chat/index.ts`); only the two
  `machine.test.ts` files import `./machine.ts` directly. A pure mechanical extraction
  that preserves the barrel surface and never renames a string literal is invisible to the
  wire contract (`project-and-chat-session-management`, `session-chat`, the state-value and
  event-type strings the orchestrator + projection read). See §3 (cross-cutting freeze list).

---

## 2. The canonical shape (target — measured against onboarding + chat-app)

The two reference machines establish the pattern this plan converges on:

| Concern | onboarding (190-LOC class, has domain VO) | chat-app (pure coordinator, no domain) |
|---|---|---|
| `machine.ts` | **175 LOC, mapping-only** | **192 LOC, mapping-only** |
| `setup/types.ts` | context/event/input/state + `ActionArgs`/`GuardArgs` | + snapshot-view types |
| `setup/actors.ts` | resolvers + `actors` bundle + `ProvidedActorOf`/`OnboardingActor` | child placeholders + `ChatAppActor` |
| `setup/guards.ts` | named-closure index → `export const guards = {…}` | same |
| `setup/actions.ts` | named-closure index; `updateContext = assign<…>` pinned once | + `forward = enqueueActions<…>` for `sendTo` |
| `setup/domain.ts` | **yes** — `OrgName` value object + failure vocab | **no** — pure coordinator |
| shared readers | (n/a) | `setup/snapshot-readers.ts` imported by guards + actions |

**The five invariants the executor must reproduce** (all already proven in the two
reference machines — cite them, don't re-derive):

1. **`machine.ts` is mapping-only:** `setup({ types, actors, guards, actions }).createMachine({…transitions…})`. Every actor/guard/action is referenced **by string**; no inline function bodies. A state-diagram header docstring, ADR bibliography terse at the **end** of the top docstring (`onboarding/machine.ts:34-37`, `chat-app/machine.ts:41-46`).
2. **Each `setup/` bundle is a named-closure index:** every function is a private module-scope `const` with its own docstring; the export references them by property shorthand (`onboarding/setup/actions.ts:132-142`, `chat-app/setup/guards.ts:53-58`). **The map key === the string the statechart names.**
3. **Type-pinning for the action bundle:** a shared `updateContext = assign<Ctx, Evt, undefined, Evt, Actor>` instantiation pins the five generics once; a per-action `assign<…>` only where `TParams` differs (onboarding's `tagCause`, `onboarding/setup/actions.ts:110-116`). chat-app proved a **mixed** bundle (`assign` + `enqueueActions`/`sendTo`) extracts cleanly by also pinning `forward = enqueueActions<…, never, never, never, never>` (`chat-app/setup/actions.ts:50-80`). **The "mixed bundle can't be extracted" worry is false.**
4. **`TActor` must be pinned** to the machine's provided-actor union or `setup({ actions })` rejects the pre-built bundle. Both references mirror XState's internal `ToProvidedActor` as `ProvidedActorOf<typeof actors>` (`onboarding/setup/actors.ts:437-443`, `chat-app/setup/actors.ts:78-86`).
5. **Shared readers live in one module** and are imported by both guards and actions, never duplicated (`chat-app/setup/snapshot-readers.ts`).

Docstrings describe **behavior**, not dev history; ADR refs are a terse bibliography at the
**end** of the file's top docstring (a prior pass already applied this across ui-state —
match it). The `README.md` "Source layout" section names the `setup/` files
(`onboarding/README.md:126-134`) — update each target's README as the final step.

---

## A. project-context

### A.1 Current structure (what lives inline in `machine.ts` today)

`machine.ts` = 879 LOC. Rough LOC per concern:

| Concern | Lines | LOC | Destination |
|---|---|---|---|
| Header docstring + imports | 1–40 | 40 | rewrite as mapping-only header |
| State / summary / cause-tag / **context** / event types | 42–139 | ~98 | `setup/types.ts` |
| Actor I/O + `*Actor` aliases + `ProjectContextMachineDeps` | 140–199 | ~60 | `setup/actors.ts` |
| `setup({...})` block — actors wiring | 214–227 | 14 | `setup/actors.ts` (`buildActors`) |
| `setup({...})` block — **1 inline guard** (`projectNameValid`) | 228–233 | 6 | `setup/guards.ts` |
| `setup({...})` block — **3 named actions** (record/clear/capture validation) | 234–252 | 19 | `setup/actions.ts` |
| `createMachine({...})` statechart — **19 inline `assign`s + 5 inline guards** | 253–519 | ~267 | stay (collapsed to string refs); bodies → `setup/actions.ts` + `setup/guards.ts` |
| **Production actor factories** (resolveInitialScope/createProject/switchProject Fn+Actor) | 522–877 | ~355 | `setup/actors.ts` |
| `ActiveScope` re-export | 878–879 | 2 | `setup/actors.ts` or `setup/types.ts` |

**Inline writes that must be named (the 19 `assign`s + 5 guards):**

- `on.open_deep_link` root handler — `assign` capturing `deeplink_*` (`263-272`).
- `resolving_initial_scope.invoke.onDone[]` — **3 inline guards** reading
  `event.output.cross_tenant` / `.project_not_found` / `.no_projects` (`324-343`) + the
  settle `assign` (project/most_recent/degraded, `346-361`) + `onError` transient
  `assign` (`366-368`).
- `no_projects.entry` — `assign underlying_cause_tag` (`373-375`).
- `creating_project.invoke.onDone` settle `assign` (`403-408`) + `onError` (`412-414`).
- `project_selected.on.switching_project_intent` — `assign deeplink_project_id` (`433-438`).
- `switching_project.invoke.onDone[]` — **2 inline guards** (`access_revoked` /
  `project_not_found`, `456-465`) + settle `assign` (`473-484`) + `onError` (`489-491`).
- `scope_mismatch_terminal.on.back_to_projects_clicked` — `assign` clearing deeplink
  (`499-503`).
- `error_recoverable.on.retry_clicked` — `assign` (clear cause, bump retries, `511-513`).

**Existing `validation.ts` (54 LOC):** `validateProjectName(raw) → ProjectValidationError | null`,
a pure function (no XState dep). It is the **direct analog of onboarding's
`constructOrgName`** in `setup/domain.ts`. Re-exported as public surface via `index.ts:41-44`.

### A.2 Gap vs canonical — concrete mapping

| Current (machine.ts:line) | → Destination | Canonical-named symbol |
|---|---|---|
| Types `42–139` | `setup/types.ts` | `ProjectContextState`, `ProjectSummary`, `ProjectContextCauseTag`, `ProjectContextMachineContext`, `ProjectContextEvent` + new `ActionArgs`/`GuardArgs` |
| Actor I/O + Deps `140–199` | `setup/actors.ts` | (unchanged names) |
| Actor factories `522–877` | `setup/actors.ts` | `resolveInitialScopeFn/Actor`, `createProjectFn/Actor`, `switchProjectFn/Actor` |
| Actors wiring `214–227` | `setup/actors.ts` | new `buildActors(deps)` returning `{ resolveInitialScope, createProject, switchProject }`; `ProjectContextActor = ProvidedActorOf<ReturnType<typeof buildActors>>` |
| `validation.ts` (sibling) | `setup/domain.ts` (move + rename) | `validateProjectName`, `ProjectValidationError` |
| inline guard `projectNameValid` `229–232` | `setup/guards.ts` | `projectNameValid` |
| inline guards `324-343` | `setup/guards.ts` | `isCrossTenant`, `isProjectNotFound`, `isNoProjects` |
| inline guards `456-465` | `setup/guards.ts` | `isAccessRevoked`, `isSwitchProjectNotFound` |
| named actions `234–252` | `setup/actions.ts` | `recordProjectValidationError`, `clearProjectValidationError`, `capturePendingProjectName` |
| `assign` `263-272` | `setup/actions.ts` | `captureDeepLinkWish` |
| `assign`s `327`, `335`, `366-368`, `412-414`, `489-491` | `setup/actions.ts` | `tagCrossTenant`, `tagProjectNotFound`, `tagTransient` (use a **parameterized `tagCause`** à la onboarding to collapse these five constant-tag assigns into one — see A.3) |
| `assign` `346-361` | `setup/actions.ts` | `assignResolvedScope` |
| `assign` `373-375` | `setup/actions.ts` | `tagNoProjects` (or `tagCause` param) |
| `assign` `403-408` | `setup/actions.ts` | `assignCreatedProject` |
| `assign` `433-438` | `setup/actions.ts` | `captureSwitchTarget` |
| `assign` `473-484` | `setup/actions.ts` | `assignSwitchedProject` |
| `assign` `499-503` | `setup/actions.ts` | `clearScopeMismatch` |
| `assign` `511-513` | `setup/actions.ts` | `clearErrorAndBumpRetries` |

**Decision — `validation.ts` becomes `setup/domain.ts`.** Justification: it is the exact
counterpart of onboarding's domain value object; the canonical layout puts the
well-formedness primitive in `setup/domain.ts`; keeping it a sibling would be the one
machine where the domain primitive sits outside `setup/`. The `index.ts` barrel keeps
re-exporting `validateProjectName` + `ProjectValidationError` (now sourced from
`setup/domain.ts`), so the public surface is unchanged.

> `nitpick (non-blocking):` `validation.ts` mixes UI copy (`"Please enter a project name"`)
> into the validation function (`validation.ts:44-52`), whereas onboarding keeps messages
> in the **action** and the domain returns only `kind` (`onboarding/setup/domain.ts:48-53`,
> messages built in `onboarding/setup/actions.ts:88-94`). This is a pre-existing divergence,
> **not in scope** for a wire-neutral extraction (moving the strings would change the
> `project_validation_error.message` surface the FE renders). Note it for a future pass;
> do **not** change it here.

### A.3 Machine-specific risks

- **`TActor` from runtime `deps`.** Unlike onboarding (module-const `actors`),
  project-context builds its actor map from `deps` at factory-call time, with a
  `fromPromise` fallback for the optional `switchProject` (`220-226`). The named actions
  in `setup/actions.ts` are module-scope consts and need the provided-actor union at
  module scope. **Solution:** make `buildActors(deps)` a module-scope function in
  `setup/actors.ts` and derive `type ProjectContextActor = ProvidedActorOf<ReturnType<typeof buildActors>>`.
  The fallback's generics must stay precise so `ReturnType` is exact. This is the **key
  type-pinning step** and the main thing to get right; verify with `npx tsc --noEmit`.
- **Parameterized `tagCause` vs five constant assigns.** Five onError/guard-branch assigns
  set `underlying_cause_tag` to a constant (`cross_tenant`, `project_not_found`,
  `transient`, `no_projects`, `access_revoked`). onboarding's `tagCause` (params `{ tag }`,
  its own `assign<…,{tag},…>`) is the proven collapse. **Risk:** the cause-tag string values
  are projected (wire-frozen). Keep the **exact** string values; only the call site changes
  from inline `assign` to `{ type: "tagCause", params: { tag: "cross_tenant" } }`.
- **Inline `onDone` guards read `event.output`,** which is not a member of
  `ProjectContextEvent`. Extracted guards take `GuardArgs` and cast `event` to
  `{ output?: … }` — identical to onboarding's `hasOrg` (`onboarding/setup/guards.ts:19-20`).
- **Test re-pointing.** `project-context/machine.test.ts` (452 LOC) imports
  `createProjectContextMachine` + 7 actor I/O **types** from `./machine.ts` (`29-38`). After
  extraction those types live in `setup/actors.ts`. Re-point the test import to
  `./setup/actors.ts` (types) and `./machine.ts` (factory), **or** to `./index.ts` (barrel).
  Prefer the barrel — it's the stable public surface and matches how every other consumer
  imports. No assertions change.
- **`open_deep_link` is a root-level handler** (`261-275`), not a per-state transition. Its
  `assign` + `target: ".resolving_initial_scope"` + `reenter: true` must survive the
  collapse verbatim (the `target`/`reenter` stay in `machine.ts`; only the `assign` body
  moves to `captureDeepLinkWish`).

### A.4 Ordered refactor plan (RPP, smallest-safe-step first)

Verify after **every** step with:
`cd ui-state && npx vitest run lib/machines/project-context && npx tsc --noEmit`

1. **Create `setup/types.ts`** — move the context/event/state/summary/cause-tag types
   (`42–139`); add `ActionArgs`/`GuardArgs`. Re-import into `machine.ts`. (Pure move; types
   only — green is fast.)
2. **Create `setup/domain.ts`** — `git mv validation.ts setup/domain.ts`; update `machine.ts`
   + `index.ts` import paths. Public re-export unchanged.
3. **Create `setup/actors.ts`** — move actor I/O types, `*Actor` aliases,
   `ProjectContextMachineDeps`, and the **3 production factories** (`522–877`); add
   `buildActors(deps)` + `ProvidedActorOf` + `ProjectContextActor`. `machine.ts` calls
   `const actors = buildActors(deps)`. (Biggest LOC move; behavior-neutral.)
4. **Create `setup/guards.ts`** — extract the 1 setup guard + 5 inline `onDone` guards as
   named closures; `export const guards`. Replace statechart guard bodies with strings.
5. **Create `setup/actions.ts`** — extract all named + 19 inline `assign`s; shared
   `updateContext`, parameterized `tagCause`. Replace statechart action bodies with strings.
6. **Collapse `machine.ts`** — it is now `setup({…}).createMachine({…})` + context factory +
   transitions only. Rewrite the header docstring (state diagram + behavior + ADR
   bibliography at end). Update `README.md` with a "Source layout" section.
7. **Re-point `machine.test.ts`** to `./index.ts` (or `./setup/*`). Run the full ui-state
   suite once: `cd ui-state && npx vitest run`.

**MR breakdown:** **1 MR** (`refactor(ui-state): project-context machine setup/ extraction`),
steps 1–7 as ordered atomic commits. Self-contained, modest size, easy test re-point.

### A.5 End-state `machine.ts` LOC target

**≈ 260 LOC** (down from 879; ~70% reduction). It will **not** reach the ~190 benchmark and
that's legitimate: project-context has **7 states** (vs onboarding's 6), a 17-field context
factory (`277–294`), a root `open_deep_link` handler, and three multi-branch `onDone` arrays
(`resolving_initial_scope` 4 branches, `switching_project` 3 branches). The irreducible
statechart is simply bigger than onboarding's. The win is that every line that remains is a
transition or a string reference — zero inline logic.

---

## B. session-chat

### B.1 Current structure

`machine.ts` = 1392 LOC. Rough LOC per concern:

| Concern | Lines | LOC | Destination |
|---|---|---|---|
| Header docstring + imports | 1–40 | 40 | rewrite as mapping-only header |
| State / `SessionSummary` / `TranscriptMessage` / cause-tag / **context** / event types | 42–166 | ~125 | `setup/types.ts` |
| Actor I/O + `*Actor` aliases + `SessionChatMachineDeps` | 168–288 | ~121 | `setup/actors.ts` |
| **noop actor fallbacks** | 297–320 | 24 | `setup/actors.ts` (`buildActors`) |
| `setup({...})` — actors wiring | 341–346 | 6 | `setup/actors.ts` (`buildActors`) |
| `setup({...})` — **4 named actions** | 347–389 | 43 | `setup/actions.ts` |
| `setup({...})` — **1 named guard** (`isStaleSessionClick`) | 390–398 | 9 | `setup/guards.ts` |
| `createMachine({...})` statechart — **25 inline `assign`s + ~9 inline guards** | 399–899 | ~500 | stay (collapsed to refs); bodies → `setup/actions.ts` + `setup/guards.ts` |
| **Production actor factories** (loadSessionList/resumeSession/switchDatasetContext/createSessionEagerly Fn+Actor) | 902–1389 | ~488 | `setup/actors.ts` |
| `ActiveScope` re-export | 1391–1392 | 2 | `setup/actors.ts` or `setup/types.ts` |

**The four production factories** are large but ordinary I/O resolvers:
`loadSessionListFn/Actor` (`908–1021`, ~114 LOC), `resumeSessionFn/Actor` (`1033–1187`,
~155 LOC), `switchDatasetContextFn/Actor` (`1209–1304`, ~96 LOC),
`createSessionEagerlyFn/Actor` (`1319–1389`, ~71 LOC). All belong in one `setup/actors.ts`
(~490 LOC — comparable to onboarding's 445-LOC actors.ts).

### B.2 Gap vs canonical — concrete mapping (the inline writes/guards)

| Current (machine.ts:line) | → `setup/actions.ts` name | Notes |
|---|---|---|
| `waiting_for_project` `project_ready` assign `431-441` | `applyProjectReady` | **dedupe candidate** ① |
| `loading_session_list` `project_ready` reset assign `453-467` | `resetForProjectSwitch` | **dedupe candidate** ② (also resets `session_list`) |
| `loading_session_list.onDone[0]` (resume) assign `493-497` | `assignSessionList` | list-only |
| `loading_session_list.onDone[1]` assign `501-505` | `assignSessionList` | **same body as above — share one action** |
| `loading_session_list.onError` assign `510-513` | `tagListDegraded` | sets cause + `last_live_state` |
| `session_list_loaded` `new_session_clicked` assign `536-541` | `enterWelcomeReset` | |
| `session_list_loaded` `project_ready` reset `551-565` | `resetForProjectSwitch` | **dedupe ②** |
| `resuming_session.onDone[0]` (not_found) assign `586-594` | `clearResumeTarget` | |
| `resuming_session.onDone[1]` (active) assign `602-632` | `assignResumedSession` | atomic transcript+resource — **do not split** |
| `resuming_session.onError` assign `637-640` | `tagTransientResuming` | |
| `session_active` `project_ready` reset `679-691` | `resetForProjectSwitch` | **dedupe ②** (no `pending_resume_session_id`/`pending_first_message` reset — see risk) |
| `switching_dataset_context.onDone[0]` (denied) assign `728-732` | `tagDatasetDeniedClearPick` | |
| `switching_dataset_context.onDone[1]` assign `740-751` | `assignSwitchedDataset` | |
| `switching_dataset_context.onError` assign `756-759` | `tagTransientSwitching` | |
| `session_welcome` `project_ready` reset `804-817` | `resetForProjectSwitch` | **dedupe ②** (adds `pending_first_message: ""`) |
| `creating_session.onDone` assign `833-839` | `assignCreatedSession` | |
| `creating_session.onError` assign `843-846` | `tagTransientCreating` | |
| `error_recoverable` retry assigns ×4 `857-893` | `clearErrorAndBumpRetries` | **identical body in all 4 branches — one shared action** |

| Inline guard (machine.ts:line) | → `setup/guards.ts` name |
|---|---|
| `loading_session_list.onDone[0]` `event.output.resume_target !== null` `491` | `hasResumeTarget` |
| `resuming_session.onDone[0]` `session_not_found` `583-584` | `isSessionNotFound` |
| `session_list_loaded` / `session_active` / `session_welcome` `project_ready` `project.id !== event.project_id` (`549`, `677`, `801`) | `isDifferentProject` (**one shared guard, used 3×**) |
| `switching_dataset_context.onDone[0]` `dataset_access_denied` `724-726` | `isDatasetAccessDenied` |
| `error_recoverable` retry branches ×4 `last_live_state === "…"` (`854`, `863`, `875`, `886`) | `wasLoadingList`, `wasResuming`, `wasWelcome`, `wasSwitchingDataset` (or one parameterized `cameFrom`) |

**No `setup/domain.ts`.** session-chat owns **no domain value object with behavior** — it
is an I/O + coordination machine (parity with chat-app, which also has no `domain.ts`).
`SessionSummary` / `TranscriptMessage` are DTOs → `setup/types.ts`. The transcript
event→role projection inside `resumeSessionFn` (`1108-1123`) is domain-ish but is an actor
internal; leave it in `setup/actors.ts` (optionally a private `mapEventsToTranscript`
helper there). Do **not** invent a `domain.ts`.

### B.3 Machine-specific risks

- **`project_ready` reset is NOT one block — it's ~2-3 variants.** It appears in 5 states
  (`431`, `453`, `551`, `679`, `804`) and the bodies **differ**: `waiting_for_project` does
  *not* reset `session_list`/`session_id`/`transcript` (it's the first arrival);
  `session_active` (`679`) omits the `pending_resume_session_id` reset that the others
  carry; `session_welcome` (`804`) adds `pending_first_message: ""`. **Risk:**
  over-deduping into one action silently changes which fields reset in which state — a
  behavior regression invisible to types. **Mitigation:** extract **2 named actions**
  (`applyProjectReady` for the initial-arrival variant; `resetForProjectSwitch` for the
  switch variant) and, for the two states that add one extra field, compose
  `[resetForProjectSwitch, <oneExtraAssign>]` rather than forking a third near-copy. Diff
  the field set state-by-state against the table in B.2 before collapsing. This is the
  single highest-risk part of the whole plan.
- **Atomic assigns must stay atomic.** `assignResumedSession` (`602-632`, IC-J002-3
  transcript+resource in one assign) and `assignSwitchedDataset` (`740-751`, IC-J002-5
  exactly-one resource update) carry documented atomicity invariants. Extract each as a
  **single** `assign` closure — never as multiple actions on one transition (XState runs
  array actions sequentially against the same snapshot, but splitting invites a later
  editor to reorder/interleave). Keep the invariant comment on the closure.
- **`TActor` from runtime `deps` with 4 noop fallbacks** (`297-320`). Same trick as
  project-context: module-scope `buildActors(deps)` returning the 4-actor map with the noop
  fallbacks inlined; `type SessionChatActor = ProvidedActorOf<ReturnType<typeof buildActors>>`.
  4 actors instead of 3 — verify each fallback's `fromPromise<Out, In>` generics so the
  `ReturnType` stays exact.
- **Test re-pointing.** `session-chat/machine.test.ts` (1105 LOC) imports 13 actor I/O
  **types** + `createSessionChatMachine` from `./machine.ts` (`23-36`). Re-point to
  `./index.ts` (barrel — preferred) after the actor types move to `setup/actors.ts`. 1105
  LOC is a lot of test surface to keep green; run `npx vitest run lib/machines/session-chat`
  after the actors step **and** after the actions step.
- **`switching_dataset_context` / `creating_session` are real states** (`SessionChatState`
  includes both, `42-51`) — they are wire-frozen state values the projection reads. The
  collapse must not rename or merge them.

### B.4 Ordered refactor plan (RPP)

Verify after every step:
`cd ui-state && npx vitest run lib/machines/session-chat && npx tsc --noEmit`

**MR-1 — types + actors (low risk, biggest LOC move):**
1. `setup/types.ts` — context/event/state/summary/transcript/cause-tag types (`42–166`) +
   `ActionArgs`/`GuardArgs`. Re-import into `machine.ts`.
2. `setup/actors.ts` — actor I/O types, `*Actor` aliases, `SessionChatMachineDeps`, the **4
   production factories** (`902–1389`), the noop fallbacks, `buildActors(deps)`,
   `ProvidedActorOf`, `SessionChatActor`. `machine.ts` calls `const actors = buildActors(deps)`.
3. Re-point `machine.test.ts` type imports to `./index.ts`. Full ui-state run.

**MR-2 — guards + actions + collapse (the risky one):**
4. `setup/guards.ts` — the 1 named guard + ~9 inline guards (share `isDifferentProject`;
   consider one parameterized `cameFrom` for the 4 retry guards).
5. `setup/actions.ts` — all named + 25 inline `assign`s; shared `updateContext`;
   `clearErrorAndBumpRetries` shared across the 4 retry branches; the **2 `project_ready`
   variants** per the B.3 mitigation. **Diff field-by-field against B.2 before deleting any
   inline body.**
6. Collapse `machine.ts` to mapping-only + rewritten header docstring (state diagram +
   behavior + ADR bibliography at end). Update `README.md` "Source layout".
7. Full ui-state run: `cd ui-state && npx vitest run`.

**MR breakdown:** **2 MRs** —
`refactor(ui-state): session-chat types + actors setup/ extraction`, then
`refactor(ui-state): session-chat guards + actions + machine.ts collapse`. MR-2 is where
behavior-preservation matters most; keeping it separate from the pure type/actor move makes
the risky diff small and reviewable.

### B.5 End-state `machine.ts` LOC target

**≈ 360 LOC** (down from 1392; ~74% reduction). The ~190 benchmark is **not realistic** and
should not be forced: session-chat has **9 states**, a 24-field context factory (`402–425`),
two multi-branch `onDone` arrays, and a 4-branch `error_recoverable` retry table. The
irreducible mapping-only statechart is genuinely ~360 LOC. As with project-context, the
quality bar is "every remaining line is a transition or a string reference," not a fixed LOC.

---

## 3. Cross-cutting — the wire-frozen string inventory (do NOT rename)

A pure extraction is wire-neutral **only if no string literal changes**. The executor must
preserve, byte-for-byte, every string the orchestrator (`chat-app`) and the projection layer
read off these machines:

- **Machine ids:** `"project-context"`, `"session-chat"` (consumed as `invoke.id`/`systemId`
  in `chat-app/machine.ts:136-138,171-173`).
- **State-value strings:** all 7 project-context + 9 session-chat state names. `chat-app`
  guards on `projectContextSnapshot(event).value === "project_selected"`
  (`chat-app/setup/guards.ts:37,47`); the projection (`chat-app/projection/derive-projection.ts`)
  reads state values for both children.
- **Event `type` strings:** `auth_ready`, `open_deep_link`, `switching_project_intent`,
  `create_project_submitted`, `back_to_projects_clicked`, `retry_clicked`,
  `create_project_clicked` (project-context); `project_ready`, `session_clicked`,
  `new_session_clicked`, `first_message_sent`, `refresh_session_list`,
  `dataset_resolved_by_agent`, `dataset_picked_directly`, `suggestion_chip_clicked_*`
  (session-chat). `chat-app` forwards several of these by string
  (`chat-app/setup/actions.ts:172-219`).
- **Cause-tag values:** `cross_tenant`, `project_not_found`, `no_projects`, `transient`,
  `access_revoked` / `list_sessions_degraded`, `session_not_found`, `dataset_not_found`,
  `dataset_access_denied` — projected into the FlowProjection.
- **Context field names** harvested by the projection/orchestrator (`project`, `org_id`,
  `session_id`, `transcript`, `resource`, `underlying_cause_tag`, `last_stale_intent`,
  `stale_intents_dropped_count`, `scope_reconciled_count`, `last_used_degraded_project_ids`, …).
- **Backend URL paths + `x-request-id` literals** inside the actor factories — frozen wire to
  the backend.

The named-closure-index rule **guarantees** this: the export map **key** equals the string the
statechart names, so moving a body from inline to `const fooAction` keyed as `fooAction` in
the bundle leaves the statechart string identical. The contract for the executor is: *move
definitions, replace inline functions with by-string references whose key === the current
string; rename nothing.*

---

## 4. Effort / sequencing

| | project-context | session-chat |
|---|---|---|
| Start LOC (`machine.ts`) | 879 | 1392 |
| End LOC (target) | ~260 | ~360 |
| Inline `assign`s to name | 19 | 25 |
| Inline guards to name | 5 | ~9 |
| Actor factory LOC to move | ~355 | ~488 |
| `setup/domain.ts`? | **yes** (move `validation.ts`) | **no** |
| Test file LOC to re-point | 452 | 1105 |
| Relative effort | **1×** | **~2×** |
| MRs | 1 | 2 |
| Highest risk | runtime-`deps` `TActor` pinning | `project_ready` reset variants (B.3) |

**Parallel or sequential?** They share **no files** (independent machine directories), so
there is no merge conflict surface. But both land code that runs in the **same `ui-state`
vitest suite**, and session-chat's `buildActors`/`ProvidedActorOf` type-pinning is the same
trick project-context establishes first. **Recommendation: sequential — project-context
first** (smaller, proves the deps-driven actor pinning), then session-chat's two MRs. Total
**~3 MRs**. If two engineers are available, they *can* run in parallel since file overlap is
nil, but the second engineer should read the merged project-context MR for the
`buildActors`/`ProvidedActorOf` pattern before starting session-chat's actors step.

---

## 5. References (bibliography)

**Canonical reference machines (the target shape — study before executing):**
- `ui-state/lib/machines/onboarding/machine.ts` — 175-LOC mapping-only machine; the
  parameterized-`tagCause` + `updateContext` instantiation pattern.
- `ui-state/lib/machines/onboarding/setup/{types,actors,guards,actions,domain}.ts` +
  `domain.test.ts` — the named-closure-index bundles and the `setup/domain.ts` value-object
  precedent (the analog for project-context's `validation.ts`).
- `ui-state/lib/machines/onboarding/README.md:104-134` — the "Source layout" / role-table
  README convention to reproduce in each target.
- `ui-state/lib/machines/chat-app/machine.ts` — 192-LOC mapping-only coordinator (no
  `domain.ts`); precedent that session-chat needs no `domain.ts`.
- `ui-state/lib/machines/chat-app/setup/actions.ts:50-80` — the `forward = enqueueActions<…>`
  pinning that proves a **mixed** `assign`+`sendTo` bundle extracts cleanly.
- `ui-state/lib/machines/chat-app/setup/{guards,snapshot-readers}.ts` — the shared-reader
  module imported by both guards and actions (the "extract shared helper, never duplicate"
  rule).
- `ui-state/lib/machines/chat-app/setup/actors.ts:78-86` — `ProvidedActorOf` / `ChatAppActor`,
  the `TActor`-pinning mirror both targets adapt for their `buildActors(deps)` return type.

**Review targets:**
- `ui-state/lib/machines/project-context/{machine.ts,validation.ts,index.ts,machine.test.ts,README.md}`
- `ui-state/lib/machines/session-chat/{machine.ts,index.ts,machine.test.ts,README.md}`

**ADRs / design docs cited by the machines (preserve in the collapsed-header bibliography):**
- `docs/decisions/adr-028-*.md` — machines own transitions; parent-ignorant children.
- `docs/decisions/adr-029-*.md` — ActiveScope invariants / cross-tenant rejection;
  identity-header propagation.
- `docs/decisions/adr-030-*.md` — flow_id key form / branch-relevant data flow (LEAF-C /
  Direction F: branch data flows through `event.output`).
- `docs/decisions/adr-014-*.md` — UI directives filtered from visible transcript
  (session-chat transcript fold).
- `docs/decisions/adr-027-*.md`, `adr-044-*.md` — XState actor-system / root-orchestrator
  statechart (parent coordination context).
- `docs/evolution/2026-05-16-project-and-chat-session-management/design/application-architecture.md` —
  the machine SRP split (§2A project-context, §2B session-chat). **NB:** both machines'
  docstrings still cite the pre-finalize `docs/feature/…` path (stale — the feature was
  archived to `docs/evolution/`); the collapsed-header bibliography should use this real
  path.
- `docs/discussion/ui-state-vocabulary-audit/findings.md` — vocabulary audit (the
  domain-named, not provenance-named, value-object convention).
