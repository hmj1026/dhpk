---
name: do
description: "Smart Router — map a natural-language task to the right dhpk workflow, then run it. Deterministic route-table fast path, LLM fallback for misses."
---
# /dhpk:do — Smart Router

`--route-only` performs the same classification and reports the selected
workflow without invoking it. It replaces the legacy `/dhpk:create-dev` entry.

One entry point for dhpk's 39 commands. Route a natural-language task to the
right workflow: the route table is the fast path, and a miss uses cheap repo
signals before classification.

## Step 0 — `--route-only` terminal mode

Before parsing any other intent, detect every literal `--route-only` token,
set `ROUTE_ONLY=on`, and **strip the flag from the request**. Continue only far
enough to derive the same cleaned query and selected route that normal routing
would produce; `--route-only` never becomes part of the downstream arguments.

After Step 1 resolves `MATCH`, `NO_MATCH`, or `NO_QUERY`, `ROUTE_ONLY=on` is an
early terminal branch:

- `MATCH` → print `Route only: /<skill> (<label>).`.
- `NO_MATCH` → use the same bounded classification and print `Route only: /<chosen> because <reason>.`.
- `NO_QUERY` → ask for a task description.

Then stop. Do not invoke the target Skill, `dhpk:planner`, `dhpk:architect`,
OpenSpec tooling, a worker, or any other downstream execution. This is a route
inspection mode, not a dry-run of the selected workflow.

## Step 0a–0e — normalize invocation context (single SSOT)

Parse the complete argument vector once through the immutable route boundary:

```bash
  --route-only --codex --architect --plan[=<model>[:<effort>]] \
  --worker=<claude|codex|agy|auto> \
  --reasoner=<claude|codex>[:<model>[:<effort>]] \
  --openspec|--opsx <task>
```

It returns one `route-result` context containing `routeOnly`, `codex`,
`architect`, `plan`, `worker`, `reasoner`, `openSpec`, and `cleanedQuery`.
Recognized flags are stripped before route matching; unknown text remains in
`cleanedQuery`. Do not parse these flags again in a downstream skill.

`scripts/lib/route-result.js` owns normalization and immutable shape. Routing
precedence and dispatch policy remain the SSOT in
`.cursor/dhpk/policies/execution-policy.md` and its conditional
references, including `invocation-precedence.md`; this command only carries
the normalized result across the handoff.

Defaults and gates are explicit: Codex, plan, architect, OpenSpec, worker, and
reasoner modes are opt-in; `--openspec` supersedes `--plan` only for a
change-authoring route. Missing optional providers continue with an observable
warning/result. For implementation-class routes, forward
`WORKER_OVERRIDE=<actual value|unset>` and the resolved reasoner context. For
implementation-class routes, forward the invocation override to every implementation-class route. The downstream route MUST call the shared fast-worker backend selector before its
first mechanical dispatch and must not reimplement availability, order, or
fallback logic. An ignored reasoner prints:

`--reasoner ignored: <route> is not an implementation-class route; proceeding with the default reasoning backend.`

## Step 1 — deterministic pre-route (run this first)

Run the matcher with the **cleaned query** as a single quoted argument:

```bash
```

If `CLAUDE_PLUGIN_ROOT` is unset, skip the Bash call and proceed directly
to LLM classification (the NO_MATCH path).

The matcher prints exactly one line:

- `MATCH<TAB><skill><TAB><label>` — a high-confidence deterministic route.
- `NO_MATCH` — nothing matched; you classify.
- `NO_QUERY` — the user gave no task text.

If `ROUTE_ONLY=on`, take the Step 0 terminal branch here, before enhancement,
planning, architecture consultation, or target invocation.

## Step 2 — ENHANCE (optional context)

If a `[learned-context]` block was injected at session start (the learning DB
is enabled), read those recurring signatures now — before classifying.
Factor them into Step 3's NO_MATCH decision and into the downstream workflow
(e.g. a repeatedly-failing reviewer or a hot trap that relates to this request).

## Step 3 — act on the result

**Invocation-class gate (all routes, before any Skill-tool call):** every
resolved target carries `metadata.dhpk-invocation-class`
(`explicit-only` or `implicit-eligible`; full precedence contract and
`/dhpk:do` has Explicit Routing Delegation to select one primary workflow —
it may start an `implicit-eligible` target normally, but for an
`explicit-only` target it does NOT call the Skill tool: it states the
target's exact supported invocation syntax (its `/dhpk:<name>` command form)
and stops, waiting for the user. This applies to both `MATCH` and `NO_MATCH`
resolution, and to the `dhpk:dhpk-opsx-apply-goal` handoff below — a deterministic
route-table hit or a high-confidence self-classification is confidence in the
ROUTE, not authorization to bypass the TARGET's own invocation restriction.

An `agent:<name>` route is an implementation dispatch target, not a Skill-tool
identifier. Dispatch it through the named agent when that capability is
available; if the agent, browser, or configured backend cannot be used, emit
`UNAVAILABLE` with the reason and stop. Do not silently remap an unavailable
Playwright journey to the retired post-development skill or to a generic test
runner.

For normal routes, pass the **cleaned query** (the full task with only the
`--codex`, `--plan`, `--worker`, `--reasoner`, and `--openspec`/`--opsx` opt-in
tokens removed) as the task to the downstream skill, subject to the
invocation-class gate above. The `dhpk:dhpk-opsx-apply-goal` route is the sole
handoff exception, and it is `explicit-only`: derive its required
`<change-id> [flags]` argument — pass the change id, not a prose description —
including `--worker=<actual value>` when `WORKER_OVERRIDE` is set (the target
analyzer reads that flag from `$ARGUMENTS`) and `--codex` when the generated
goal must carry it (`/dhpk:do` consumes `--codex` before route resolution, so
this must be re-added explicitly). Then, per the gate, present the exact
invocation `/dhpk:dhpk-opsx-apply-goal <change-id> [flags]` and stop — do not call
the Skill tool for it. Read the route's
[argument contract](https://github.com/hmj1026/dhpk/blob/main/docs/basic-operations.md#6-unattended-openspec-session-large-uncertainty-on-ramp)
for the argument-derivation rules this exception still needs.

For implementation-class routes, also pass the named invocation context
`WORKER_OVERRIDE=<actual value|unset>` and, when `REASONER=on`, the resolved
reasoner backend/model/effort. Then apply the codex-mode rule below to decide the
codex flag, the plan-mode rule below to decide whether a `dhpk:planner` consult
runs first, and the openspec-mode rule below to decide whether the resolved route
is diverted into the OpenSpec artifact-then-review flow (which supersedes the
plan consult). The canonical execution-policy orchestration decision policy still
requires a planner before an existing OpenSpec apply with two or more unchecked
tasks; `/dhpk:do --plan` is optional and never suppresses that mandatory gate.

- **`MATCH`** → when the target is `agent:<name>`, dispatch the named agent and
  apply its availability contract. Otherwise resolve `<skill>`'s invocation
  class. If `implicit-eligible`,
  invoke it immediately with the **Skill** tool (e.g. `dhpk:dhpk-adaptive-dev-workflow`); do
  **not** re-classify — the route table already matched. State one line:
  `Routing to /<skill> (<label>).` If `explicit-only`, do not call the Skill
  tool: state `Routing to /<skill> (<label>) — explicit-only; run: /<skill>
  <args>` and stop.
- **`NO_MATCH`** → before guessing, gather a few **cheap repo signals** to
  disambiguate (evidence beats a blind classification, but stay one-shot — do not
  start exploring the codebase). Quick checks only, e.g.:
  - `git status --porcelain` non-empty → dirty worktree (a "are we done?" /
    "收尾" request likely means `dhpk:verify` or `dhpk:review-pending`).
  - `ls openspec/changes/ 2>/dev/null` shows an active change → a "finish it" /
    "跑完它" request likely means `dhpk:dhpk-opsx-apply-goal` (unattended) or `/opsx:apply`.
  - test config / build config present → verification-class intent is plausible.

  Then classify the request yourself and pick the single best-fit dhpk command.
  Resolve its invocation class exactly as in `MATCH` above: invoke
  `implicit-eligible` targets via the **Skill** tool and state one line citing
  the evidence — `No deterministic route; routing to /<chosen> because
  <reason + signal>.` — or, for an `explicit-only` target, state `No
  deterministic route; best fit is /<chosen> because <reason + signal> —
  explicit-only; run: /<chosen> <args>` and stop without invoking it.
  Common targets: `dhpk:dhpk-adaptive-dev-workflow` (**any** substantial bug or
  feature change — it classifies, owns the selected branch, and runs the shared
  delivery-loop gates; enter it rather than a retired branch-specific route;
  this mirrors the deterministic route table, which sends every bug/feature
  pattern here),
  `dhpk:dhpk-codebase-exploration`, `dhpk:review-pending`, `dhpk:dhpk-security-review`,
  `dhpk:dhpk-project-audit`, `dhpk:simplify`, `dhpk:dhpk-tech-spec`, `dhpk:dhpk-risk-assess`,
  `dhpk:dhpk-deploy-list`, `dhpk:dhpk-feasibility-study`, `dhpk:verify`, `dhpk:dhpk-opsx-apply-goal`
  (explicit-only), `dhpk:create-pr` (explicit-only), `dhpk:smart-commit`
  (explicit-only). If nothing fits, say so and ask one clarifying question
  instead of guessing.
- **`NO_QUERY`** → ask the user what they want to do; do not route.

Completion criterion: exactly one terminal branch completes — `MATCH` hands off
the table-selected skill, `NO_MATCH` hands off one evidence-backed classification
or asks one clarifying question, and `NO_QUERY` asks for a task description.

### Codex-mode rule (how `CODEX` shapes the invocation)

- **`CODEX=off` (default):** invoke the target codex-free.
  - One exception — `dhpk:dhpk-feasibility-study` defaults codex-**on**, so pass
    `--no-codex` to it to honor the codex-free default.
- **`CODEX=on`:** append `--codex` when the target supports a codex mode —
  `dhpk:dhpk-adaptive-dev-workflow`. Special cases:
  - **Security** has no in-skill codex mode: route to the dedicated codex command
    instead — `dhpk:dhpk-security-review` (default) → **`dhpk:codex-security`** under `--codex`.
  - `dhpk:dhpk-feasibility-study`: invoke **without** `--no-codex` (its default already uses Codex).
  - An explicit `dhpk:codex-*` skill: route as-is.
  - Any other target: the flag has no effect — route normally.

### Architect-consult rule (how architecture-relevant tasks pull in `dhpk:architect`)

Under `PLAN=on` **or** `OPENSPEC=on`, when the cleaned query describes a **new
feature that needs architectural judgment or architecture research** — cross-module
design, a new subsystem, or a layering / boundary decision — dispatch a
`dhpk:architect` subagent **before** the downstream flow and fold its opinion in:

- under **PLAN**, into the plan brief handed to `dhpk:planner` (Plan-mode rule
  step 1 below);
- under **OPENSPEC**, into the change description handed to `opsx:new` (Openspec-mode
  rule step 1 below).

The trigger is a **semantic judgment**, not a keyword match:

- **Consult (positive example):** "add a cross-module event bus so billing and
  notifications stop calling each other directly" — a new subsystem with
  cross-module boundary implications; dispatch `dhpk:architect` first.
- **Skip (negative example):** "fix the off-by-one in `InvoiceTotal::round()`" or
  "rename one column in a single migration" — mechanical or single-module work
  carries no architecture decision, so **no** architect dispatch occurs and the
  downstream consult / flow proceeds unchanged.

Dispatch `dhpk:architect` at its configured tier (default `fable` / `low`; see
`rules/model-economics.md`), then fold its conclusion into the relevant brief and
continue with the mode rule below. This consult is **additive**: it never replaces
the `dhpk:planner` consult (PLAN) or the artifact-then-review flow (OPENSPEC).

### Plan-mode rule (how `PLAN` shapes the invocation)

- **`PLAN=off` (default):** invoke the target normally, no `dhpk:planner`
  consult, except that an existing OpenSpec apply with two or more unchecked
  tasks must run the canonical planner gate. One clear unchecked task records
  `planner=skipped`.
- **`PLAN=on`:** a pre-implementation `dhpk:planner` consult activates **only**
  when the resolved route target is one of the two implementation-class
  skills — `dhpk:dhpk-adaptive-dev-workflow` or `dhpk:dhpk-opsx-apply-goal`.
  **Precedence:** if `OPENSPEC=on` and the resolved route
  is a change-authoring route (see the Openspec-mode rule below), the planner
  consult is **suppressed** — `--openspec` supersedes `--plan`. Any other
  resolved route prints this literal one-line message and proceeds with that
  route unaffected, with **no** `dhpk:planner` dispatch:

  `--plan ignored: <route> is not an implementation-class route; proceeding without a planner consult.`

  On activation, before invoking the target skill:
  1. **Assemble a plan brief** for `dhpk:planner` — conclusions-not-context,
     capped at ≤3.5k tokens. The brief contains: the task verbatim, session
     constraints, a file map, pasted load-bearing code excerpts (not paths
     alone), the REJECTED-alternative line (which alternative was already
     weighed and why it was killed), a lookup fence stating the orchestrator
     has already resolved discovery and `dhpk:planner` should treat unresolved
     lookups as the exception, not the norm, and either a DRAFT PLAN (critique
     mode, the default) or an explicit blind-sketch request (draft withheld).
     When the Architect-consult rule above fired for this task, fold the
     `dhpk:architect` conclusion into this brief before dispatching the planner.
  2. **Dispatch `dhpk:planner`** with the brief, using the resolved model/effort
     from Step 0b.
  3. **Check for the trailing `END` line.** A reply missing it is treated as
     truncated — re-consult `dhpk:planner` exactly once. If the retry also
     lacks `END`, degrade to proceeding **without** a verdict and disclose this
     in the one-line status output. Never treat a missing `END` as an implicit
     `ENDORSE`.
  4. **Fold the verdict into the task handed to the target skill:**
     - `VERDICT: ENDORSE` → the original plan passes through unchanged.
     - `VERDICT: AMEND` → append the planner's deltas (`S2 <fix>` /
       `+<new step>` / `-<cut step>`) to the task brief handed to the target
       skill; unlisted steps stand as drafted.
     - `VERDICT: REPLACE` → substitute the planner's numbered plan outright as
       the task brief handed to the target skill.
  5. **Record the warm-review obligation.** When a pre-implementation consult
     occurred, state in `/dhpk:do`'s own output that a post-implementation warm
     review (task-end diff review) is **owed**. This command only creates and
     surfaces that obligation — honoring it requires the orchestrator to
     **manually re-invoke `dhpk:planner`** at task end with the warm-review
     brief; there is no automatic resume that fires this on its own.

For an existing OpenSpec apply, count unchecked tasks before implementation. Two
or more unchecked tasks require the same planner consult even without `--plan`;
one clear task records `planner=skipped`. This is the canonical execution-policy
decision policy, not a change-authoring `--openspec` diversion.

### Openspec-mode rule (how `OPENSPEC` shapes the invocation)

- **`OPENSPEC=off` (default):** invoke the target normally, no OpenSpec
  diversion.
- **`OPENSPEC=on`:** the artifact-then-review flow activates **only** when the
  resolved route target is the **change-authoring** route
  `dhpk:dhpk-adaptive-dev-workflow`. On that route,
  instead of invoking the target skill:
  1. **Discover** whether the external OpenSpec authoring entries
     `openspec-new-change` and `openspec-ff-change` are both available to
     Claude's Skill tool (do not infer callability from plugin
     installed/enabled status — check the actual callable surface). These are
     external OpenSpec-owned Skill-tool IDs, not the human-facing `/opsx:new` /
     `/opsx:ff` command aliases — never pass `opsx:new` or `opsx:ff` to the
     Skill tool.
     - **Both available:** invoke `openspec-new-change` then
       `openspec-ff-change` via the **Skill** tool to emit the change artifacts
       (proposal / design / specs / tasks) for the cleaned query. When the
       Architect-consult rule above fired for this task, fold the
       `dhpk:architect` conclusion into the change description handed to
       `openspec-new-change`.
     - **Either unavailable or explicit-only to model invocation:** present the
       matching exact human command, `/opsx:new` (then `/opsx:ff`), and stop —
       do not bypass the entry's invocation restriction and do not edit its
       generated metadata to work around the mismatch.
  2. **Stop for human review** — do **not** proceed to implementation. State
     that the change awaits review and can be applied later with `/opsx:apply`
     (or an unattended `dhpk:dhpk-opsx-apply-goal` session).

  Because this supersedes `--plan`, when `OPENSPEC=on` activates on a
  change-authoring route, **no** `dhpk:planner` consult runs even if `--plan`
  was also passed.

  Any other resolved route — **including `dhpk:dhpk-opsx-apply-goal`**, which applies
  an *existing* change (it emits a `/goal` string for a fresh session, so
  `opsx:new` does not apply) — prints this literal one-line message and proceeds
  with that route unaffected:

  `--openspec ignored: <route> is not a change-authoring route; proceeding without OpenSpec artifact creation.`

## Notes

- The route table is the SSOT: `scripts/lib/route-table.json`. To add or retune
  a deterministic route, edit that file — both this router and the
  UserPromptSubmit skill-hint pick it up automatically.
- Invoke an underlying command or skill directly when bypassing the router is
  clearer; `/dhpk:do` remains the natural-language entry point.

## Example Output

One line per outcome — the router states where it went, then hands off:

```text
# MATCH (deterministic route table hit)
Routing to /dhpk:dhpk-adaptive-dev-workflow (adaptive dev workflow (bug)).

# NO_MATCH (classified from cheap repo signals)
No deterministic route; routing to /dhpk:verify because worktree is dirty and the request ("收尾") reads as a wrap-up.

# NO_QUERY (no task text given)
No task described — what would you like to do? (e.g. "fix the login bug", "review my branch")
```

User request: $ARGUMENTS
