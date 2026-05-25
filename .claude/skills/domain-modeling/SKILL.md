---
name: domain-modeling
description: Use when modeling a concept in TypeScript and choosing between `type`, `interface`, `class`, and Zod — maps DDD building blocks (entity, value object, port, use case, command, DTO) and hexagonal layers (domain / application / adapter) to the right tool. Reach for this when adding a domain model, a DTO, a port, a validation schema, or when unsure whether something should be a class vs an interface vs a Zod schema.
---

# Modeling Tools in a DDD / Hexagonal TypeScript Codebase

How to choose between `type`, `interface`, `class`, and Zod — framed by
**where a concept lives in the architecture**. The governing idea:

> In hexagonal architecture, the **layer** a thing belongs to, and the **DDD
> building block** it represents, largely determine which tool models it.
> Decide *what* you're building first; the tool falls out of that.

The four tools live on different planes, so they are usually a **pipeline across
the hexagon's boundary**, not competitors:

| Tool | Compile time? | Run time? | Carries behavior? | Typical home |
|---|---|---|---|---|
| `type` / `interface` | yes | **no** (erased) | no | ports, DTOs, commands |
| `class` | yes | **yes** | **yes** | domain core, adapters, use cases |
| Zod schema | type via `z.infer` | **yes** | validation only | inbound boundary only |

---

## The dependency rule (decide everything from this)

The hexagon has one law: **dependencies point inward.** The domain core depends on
nothing external; the application layer depends only on the domain; adapters depend
on the layers inside them. Nothing inner ever imports anything outer.

This single rule drives most tool choices:

- The **domain** may not import Zod, an ORM, or HTTP types → so the domain models
  itself with **classes** and the **interfaces** it owns (its ports), nothing else.
- **Validation of untrusted input is an *outer* concern** → Zod lives at the
  inbound boundary, never in the core.
- **Serialization shapes are an *outer* concern** → DTOs are `type`/`interface`
  defined at (or mapped at) the boundary, not the domain object itself.

When unsure which tool to use, first ask **"which ring am I in?"**

```
        ┌─────────────────────────────────────────────┐
        │  ADAPTERS  (inbound + outbound)               │
        │  Zod schemas · controllers · repo impls ·     │
        │  persistence models · mappers · DTOs          │
        │   ┌───────────────────────────────────────┐  │
        │   │  APPLICATION                           │  │
        │   │  use cases (class) · use-case ports    │  │
        │   │  (interface) · commands/queries (type) │  │
        │   │   ┌───────────────────────────────┐    │  │
        │   │   │  DOMAIN CORE                   │    │  │
        │   │   │  entities · aggregates ·       │    │  │
        │   │   │  value objects · domain events │    │  │
        │   │   │  (all classes / branded types) │    │  │
        │   │   │  repository PORTS (interface)  │    │  │
        │   │   └───────────────────────────────┘    │  │
        │   └───────────────────────────────────────┘  │
        └─────────────────────────────────────────────┘
            dependencies point INWARD only ───────►
```

---

## Layer by layer: what lives there and what models it

### Domain core — `class` (+ branded `type`, + `interface` for ports it owns)

The innermost ring. Pure business model, zero infrastructure imports.

- **Entity / Aggregate root** → **`class`.** Identity, lifecycle, and invariants
  that span its own state. The aggregate root is the consistency boundary: outside
  code touches the aggregate only through the root, and every state-spanning rule is
  enforced in its methods.
- **Value object** → **`class`** when it carries behavior or needs nominal identity
  (`Money`, `Email`); **branded `type`** when it's just a validated primitive with
  no behavior (`type Email = string & { readonly __brand: unique symbol }`).
- **Domain event** → **`class`** (or a `readonly` `type` if it's a pure record);
  it's an immutable fact, so freeze it.
- **Domain service** → **`class`.** Stateless behavior that doesn't belong to any
  single entity.
- **Repository / gateway *ports*** → **`interface`**, *defined in the domain* but
  *implemented in an adapter*. This is dependency inversion: the core declares the
  contract it needs; the outside satisfies it.

Idiomatic domain-class shape (so invariant enforcement is the **default**):
- `private` fields, exposed via getters or read-only views.
- `private constructor` + static `create` factory that runs birth invariants.
- separate static `reconstitute` / `fromPersistence` factory for rehydration
  (trusts already-validated persisted state).
- methods that guard state transitions (`submit()`, `addLine()`).
- a `private` brand field when you must block structurally-identical impostors
  (classes are structural in type position — a plain object of the right shape
  passes the type checker, though not `instanceof`).

### Application layer — `class` for use cases, `interface`/`type` for their contracts

Orchestrates the domain; defines the application's ports.

- **Use case / application service** → **`class`.** Loads aggregates via repository
  ports, invokes domain behavior, coordinates the transaction, persists.
- **Inbound port (driving)** → **`interface`** (`PlaceOrderUseCase`). The contract a
  controller calls.
- **Command / query** → **`type` / `interface`.** Plain trusted data handed to a use
  case *after* the boundary has already validated it.

### Adapters / boundary — Zod inbound, `class` for impls, `type` for DTOs

The outer ring. The only place that knows about HTTP, the DB, queues, or JSON.

- **Inbound adapter (controller, consumer)** → **`class`**, and it uses a **Zod
  schema** to validate untrusted input, then maps the result into a domain object
  via a factory.
- **Boundary input validation** → **Zod schema.** HTTP bodies, params, env/config,
  third-party responses, queue/event payloads, anything from `JSON.parse`.
- **DTO / response shape** → **`type` / `interface`** (derive with `z.infer` when
  it's a schema's parse target).
- **Outbound adapter (repository implementation)** → **`class`** implementing the
  domain's repository port.
- **Persistence model / row shape** → **`type` / `interface`** (or the ORM's entity)
  — kept distinct from the domain aggregate.
- **Mappers** (domain ↔ DTO, domain ↔ persistence) → plain functions or a small
  `class`, living in the adapter.

---

## DDD building block → tool (quick map)

| DDD / hexagonal building block | Ring | Tool |
|---|---|---|
| Entity | domain | **class** |
| Aggregate root | domain | **class** |
| Value object (with behavior/identity) | domain | **class** |
| Value object (validated primitive only) | domain | **branded `type`** |
| Domain event | domain | **class** / `readonly type` |
| Domain service | domain | **class** |
| Repository / gateway **port** | domain (defined) | **`interface`** |
| Use case / application service | application | **class** |
| Inbound (driving) port | application | **`interface`** |
| Command / query | application | **`type` / `interface`** |
| Inbound adapter (controller) | adapter | **class** + **Zod** |
| Boundary input validation | adapter | **Zod schema** |
| DTO / wire shape | adapter | **`type`** (`z.infer` if parsed) |
| Outbound adapter (repo impl) | adapter | **class** (implements port) |
| Persistence / row model | adapter | **`type` / `interface`** |

---

## Crossing the boundary: the canonical pipeline

A request flows inward through the rings, and each tool does the job the next can't:

```
raw input (unknown, outside the hexagon)
  → [inbound adapter] Zod schema   validate structure/format  → typed DTO
  → [application]      DTO (z.infer)/command crosses inward
  → [domain core]      class factory + methods enforce business invariants
  ← [application]       persist via repository PORT (interface)
  ← [outbound adapter] class impl maps domain → persistence model
  ← [inbound adapter]  map domain → DTO (type) for the response
```

- **Zod** checks `qty > 0` and "is a uuid" — structural/format facts. It **cannot**
  check "this order isn't already submitted" (stateful, behavioral).
- The **domain class** enforces that business rule. It **shouldn't** parse untrusted
  JSON — that's an outer-ring concern.
- The **`type`** is the zero-runtime-cost handoff shape between rings.

This is why "just use Zod everywhere" fails (it validates *data*, not *behavior*,
and dragging it inward breaks the dependency rule) and "use classes for DTOs too"
fails (a class serialized to the wire loses its methods/prototype — keep transport
objects dumb and outside the core).

---

## Anti-patterns = architecture violations

Most mistakes here are recognizable as breaches of a DDD/hexagonal rule:

- **Anemic domain model.** A "domain class" that's just public fields with all logic
  in services — a DTO with extra steps. *Behavior belongs on the aggregate.*
- **Dependency-rule violation: Zod in the domain.** The core importing a validation
  library. Validation is an outer-ring concern; keep Zod at the inbound boundary.
- **Dependency-rule violation: ORM / HTTP in the domain.** Same breach. The core
  imports nothing infrastructural.
- **Business rules in `.refine()`.** Domain logic leaking outward into boundary
  schemas. State/lifecycle rules are aggregate methods, not schema refinements.
- **Class as DTO / class on the wire.** Sending an aggregate across the boundary; it
  serializes to a plain object and loses behavior. Map to a `type` DTO at the edge.
- **Domain aggregate used as the persistence model.** Couples the core to the DB
  schema. Keep a separate row/persistence type and map in the outbound adapter.
- **Port defined in the adapter instead of the domain.** Inverts the dependency
  arrow. The *domain* owns the repository `interface`; the adapter *implements* it.
- **Hand-written DTO duplicating a schema.** Two definitions that drift — derive the
  DTO with `z.infer` from the schema instead.
- **Trusting a `type` on boundary data.** Annotating unvalidated input rather than
  parsing it — the value is really `unknown` until Zod checks it.
- **Relying on a class type for safety without a brand.** Type position is
  structural; add a `private` brand to make it effectively nominal.
- **`I`-prefix interfaces / first-party `.d.ts` for domain types.** Not idiomatic in
  TS (and not used in this repo). Name interfaces by role; co-locate the type with
  its class in a normal `.ts`. Precedent here: `BeginStrategy` (interface) +
  `SessionOnboardingBeginStrategy` (class).

---

## Edge cases, resolved

- **DTO: `interface` or `z.infer`?** Schema's parse target → `z.infer` (one source of
  truth). Purely internal trusted shape you never validate → hand-written
  `interface`.
- **Value object: `class` or branded `type`?** Class for behavior/identity; branded
  type for a validated primitive with zero runtime overhead.
- **Enum-like set?** `type` union of string literals
  (`type OrderStatus = "draft" | "submitted"`), not a TS `enum`.
- **Where do mappers live?** In the adapter ring, never in the domain. The core
  doesn't know what it's being mapped *to*.
- **Rehydrating an aggregate from the DB?** A static `reconstitute` factory that
  trusts persisted state, separate from `create` which runs birth invariants.

---

## Two-step heuristic

1. **Locate the ring + building block.** "Is this domain, application, or adapter?
   Is it an entity/VO/port/use-case/DTO/schema?" The layer map above answers the
   tool directly for almost every case.

2. **If still ambiguous, run the trust/behavior check:**
   - Untrusted data crossing the boundary inward? → **Zod** (+ `z.infer`).
   - Behavior, identity, or invariants over its own state? → **class.**
   - Trusted pure shape/contract with no runtime need? → **`type` / `interface`.**

If a concept seems to need several tools, it's a **pipeline crossing the boundary**,
not a conflict: Zod at the edge → DTO inward → class in the core.

---

## This codebase

Applied example: `ui-state/lib/domain/` holds `FlowEvent` (domain model, a `class`
owning construction + behavior + its serialized form), `FlowEventRecord` (the plain
DTO `type` for the Redis/wire shape), and `FlowId` (value object). The `redis.ts`
**outbound adapter** owns (de)serialization (`createCacheSerialization` /
`fromCache`), reconstructing the model from persisted state — the domain never parses
untrusted bytes. Inbound HTTP routers validate with **Zod** at the boundary, then map
into domain objects. See ADR-028/041 and the session-onboarding evolution docs.
