---
description: 'Smart Router — map a natural-language task to the right dhpk workflow, then run it. Deterministic route-table fast path, LLM fallback for misses.'
argument-hint: '[--codex] [--plan[=<model>[:<effort>]]] [--worker=<claude|codex|agy|auto>] [--reasoner=<claude|codex>[:<model>[:<effort>]]] [--openspec|--opsx] <natural language task>'
allowed-tools: 'Bash(bash:*), Bash(git:*), Bash(ls:*), Skill, Read, Grep, Glob'
---

# /dhpk:do — Smart Router

One entry point for dhpk's 45 commands. Route a natural-language task to the
right workflow: the route table is the fast path, and a miss uses cheap repo
signals before classification.

## Step 0a — parse codex intent (default: codex-free)

dhpk runs **codex-free by default** — not every install has the Codex CLI/MCP.
Codex is an explicit opt-in:

- Set `CODEX=on` only if the request carries an explicit opt-in: a `--codex`
  token, or an unmistakable natural-language directive ("use codex",
  "with codex", "用 codex", "走 codex"). Otherwise `CODEX=off`.
- **Strip** the `--codex` token (and a leading "use/with codex" directive) from
  the request text before matching, so it never pollutes the route patterns.
  Call the stripped text the *cleaned query*.
- If `CODEX=on` but no `mcp__codex__*` tool and no Codex CLI is available, warn
  once (`Codex requested but unavailable — falling back to codex-free.`) and set
  `CODEX=off`.

## Step 0b — parse plan intent (default: off, opt-in)

`/dhpk:do` supports an opt-in pre-implementation plan critique via
`dhpk:planner`, parsed and stripped exactly like `--codex` above:

- Detect an optional `--plan[=<model>[:<effort>]]` token **before** route-table
  matching. If present, set `PLAN=on` and **strip** the token from the request
  text before matching, so the cleaned query never contains it — this keeps
  `scripts/lib/route-table.json` and `scripts/lib/pre-route.sh` untouched.
  Otherwise `PLAN=off`.
- Parse the flag value into a `<model>` and an `<effort>`:
  - `--plan` (bare) → model `opus`, effort `high`.
  - `--plan=fable` → model `fable`, effort `high`.
  - `--plan=fable:medium` → model `fable`, effort `medium`.
  - `--plan=:low` → model unset (falls through to default resolution below),
    effort `low`.
- Resolve the final model/effort with this precedence (highest wins): an
  explicit `--plan=...` flag value > `planner_model`/`planner_effort`
  userConfig (when set) > the built-in default `opus`/`high`. This mirrors the
  existing `deep_reasoner_model`/`deep_reasoner_effort` override chain — no new
  precedence pattern.
- Carry `PLAN=on` and the resolved model/effort forward into Step 3. `PLAN=on`
  does not by itself change the route: it only decides, in Step 3, whether a
  `dhpk:planner` consult happens before the target skill is invoked.

## Step 0c — parse openspec intent (default: off, opt-in)

`/dhpk:do` supports an opt-in flag that forces the OpenSpec authoring flow
(emit change artifacts, then pause for human review) instead of implementing,
parsed and stripped exactly like `--plan` above:

- Detect an optional `--openspec` token (alias `--opsx`) **before** route-table
  matching. If present, set `OPENSPEC=on` and **strip** the token (both spellings)
  from the request text before matching, so the cleaned query never contains it —
  this keeps `scripts/lib/route-table.json` and `scripts/lib/pre-route.sh`
  untouched, identical to the `--codex`/`--plan` strip-before-match contract.
  Otherwise `OPENSPEC=off`.
- Carry `OPENSPEC=on` forward into Step 3. It does not by itself change the
  route: it decides, in Step 3, whether the resolved route is diverted into the
  `opsx:new` → `opsx:ff` artifact-then-review flow.
- **Precedence over `--plan`:** when both `--openspec` and `--plan` are supplied,
  `--openspec` wins — the flow terminates at artifact generation and human
  review, so the `dhpk:planner` consult is skipped (see the Openspec-mode rule
  in Step 3).

## Step 0d — parse worker override (optional)

- Detect and strip `--worker=<claude|codex|agy|auto>` before route-table
  matching, exactly like `--codex`/`--plan`; it must not pollute the cleaned query.
  The prior fast-worker flag spelling is **removed** — that older token is not
  recognized, not aliased, and gets no special-case handling; if present it flows
  through as ordinary task text.
- Before stripping it, preserve the actual value in the named invocation context
  `WORKER_OVERRIDE=<actual value|unset>`; never reconstruct it from the
  cleaned query or replace it with a route name.
- Resolve the invocation backend with precedence flag > `fast_worker_backend`
  userConfig > shipped default (`claude`). Invalid values emit one warning line
  and fall back to userConfig/default without failing the route. (The `--worker`
  flag renames only the surface token; the `fast_worker_backend` userConfig key
  and the `scripts/fast-worker-selector.js` engine interface are unchanged.)
- For the implementation-class routes (`dhpk:adaptive-dev-workflow`,
  `dhpk:bug-fix`, `dhpk:feature-dev`, and `dhpk:opsx-apply-goal`), forward the invocation override to every implementation-class route; it applies to this
  invocation only. The downstream route MUST call the shared fast-worker backend selector before its first mechanical dispatch and must not reimplement
  availability, order, or fallback logic.

## Step 0e — parse reasoner backend (default: off, opt-in)

`/dhpk:do` supports an opt-in override for the deep-reasoning backend used by
reasoning-heavy dispatches, parsed and stripped exactly like `--plan` above:

- Detect an optional `--reasoner=<claude|codex>[:<model>[:<effort>]]` token
  **before** route-table matching. If present, set `REASONER=on` and **strip**
  the token from the request text before matching, so the cleaned query never
  contains it. Otherwise `REASONER=off` (reasoning dispatches route to the
  default `dhpk:deep-reasoner` exactly as before).
- Only `claude` and `codex` are valid backends. `agy` is explicitly
  **unsupported** (no reasoning-grade model): an `--reasoner=agy` (or any other
  non-`claude|codex` value) emits one warning line and falls back to the
  userConfig/default resolution below **without failing the route**.
- Backend routing: `claude` → `dhpk:deep-reasoner`; `codex` →
  `dhpk:codex-deep-reasoner`.
- Parse the flag value into a `<backend>`, optional `<model>`, and optional
  `<effort>` (`--reasoner=codex:gpt-5.6-sol:medium` fully specifies;
  `--reasoner=codex` leaves model/effort to the chain below). Resolve model/effort
  with this precedence (highest wins), mirroring the `--plan` chain — no new
  precedence pattern:
  - **claude:** explicit `--reasoner=claude:...` segments > `deep_reasoner_model`/
    `deep_reasoner_effort` userConfig > `agents/deep-reasoner.md` frontmatter default.
  - **codex:** explicit `--reasoner=codex:...` segments > `codex_deep_reasoner_model`/
    `codex_deep_reasoner_effort` userConfig > built-in `gpt-5.6-sol` / `high`.
- **Missing-executable fallback (codex only):** when `--reasoner=codex` is active
  but no codex executable is available, emit one warning line and fall back to
  `dhpk:deep-reasoner`. This missing-executable case is the **only** silent
  substitution — authentication, model-rejection, and task failures at execution
  time remain `RESULT: BLOCKED` per the codex-fast-worker/selector semantics.
- Carry `REASONER=on` and the resolved backend/model/effort forward into Step 3.
  The flag affects **only** implementation-class routes (`dhpk:adaptive-dev-workflow`,
  `dhpk:bug-fix`, `dhpk:feature-dev`, `dhpk:opsx-apply-goal`); on any other
  resolved route print this literal one-line message and proceed unaffected:

  `--reasoner ignored: <route> is not an implementation-class route; proceeding with the default reasoning backend.`

## Step 1 — deterministic pre-route (run this first)

Run the matcher with the **cleaned query** as a single quoted argument:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/lib/pre-route.sh" "<cleaned query>"
```

If `CLAUDE_PLUGIN_ROOT` is unset, skip the Bash call and proceed directly
to LLM classification (the NO_MATCH path).

The matcher prints exactly one line:

- `MATCH<TAB><skill><TAB><label>` — a high-confidence deterministic route.
- `NO_MATCH` — nothing matched; you classify.
- `NO_QUERY` — the user gave no task text.

## Step 2 — ENHANCE (optional context)

If a `[learned-context]` block was injected at session start (the learning DB
is enabled), read those recurring signatures now — before classifying.
Factor them into Step 3's NO_MATCH decision and into the downstream workflow
(e.g. a repeatedly-failing reviewer or a hot trap that relates to this request).

## Step 3 — act on the result

For normal routes, pass the **cleaned query** (the full task with only the
`--codex`, `--plan`, `--worker`, `--reasoner`, and `--openspec`/`--opsx` opt-in
tokens removed) as the task to the downstream skill. The
`dhpk:opsx-apply-goal` route is the sole handoff exception: derive its required
`<change-id> [flags]` argument — pass the change id, not a prose description —
then pass that argument string to the skill and end this session after it emits
the fresh-session `/goal` package. Because `/dhpk:do`
consumes `--codex` before route resolution, invoke `dhpk:opsx-apply-goal` directly
when the generated goal must carry its own `--codex` flag. Read the route's
[argument contract](../docs/basic-operations.md#5-unattended-openspec-session)
only for this exception. When `WORKER_OVERRIDE` is set, include
`--worker=<actual value>` in the handoff argument because the target analyzer
reads that flag from `$ARGUMENTS`.

For implementation-class routes, also pass the named invocation context
`WORKER_OVERRIDE=<actual value|unset>` and, when `REASONER=on`, the resolved
reasoner backend/model/effort. Then apply the codex-mode rule below to decide the
codex flag, the plan-mode rule below to decide whether a `dhpk:planner` consult
runs first, and the openspec-mode rule below to decide whether the resolved route
is diverted into the OpenSpec artifact-then-review flow (which supersedes the
plan consult).

- **`MATCH`** → invoke `<skill>` immediately with the **Skill** tool (e.g.
  `dhpk:bug-fix`). Do **not** re-classify — the route table already matched.
  State one line: `Routing to /<skill> (<label>).`
- **`NO_MATCH`** → before guessing, gather a few **cheap repo signals** to
  disambiguate (evidence beats a blind classification, but stay one-shot — do not
  start exploring the codebase). Quick checks only, e.g.:
  - `git status --porcelain` non-empty → dirty worktree (a "are we done?" /
    "收尾" request likely means `dhpk:verify` or `dhpk:review-pending`).
  - `ls openspec/changes/ 2>/dev/null` shows an active change → a "finish it" /
    "跑完它" request likely means `dhpk:opsx-apply-goal` (unattended) or `/opsx:apply`.
  - test config / build config present → verification-class intent is plausible.

  Then classify the request yourself and pick the single best-fit dhpk command,
  invoke it via the **Skill** tool, and state one line citing the evidence:
  `No deterministic route; routing to /<chosen> because <reason + signal>.`
  Common targets: `dhpk:adaptive-dev-workflow` (**any** substantial bug or feature
  change — it classifies + gates, then routes into `dhpk:bug-fix` /
  `dhpk:feature-dev` itself, so enter it rather than those two directly; this
  mirrors the deterministic route table, which sends every bug/feature pattern
  here),
  `dhpk:code-explore`, `dhpk:review-pending`, `dhpk:security-review`,
  `dhpk:project-audit`, `dhpk:simplify`, `dhpk:tech-spec`, `dhpk:risk-assess`,
  `dhpk:deploy-list`, `dhpk:feasibility-study`, `dhpk:verify`, `dhpk:opsx-apply-goal`,
  `dhpk:create-pr`, `dhpk:smart-commit`. If nothing fits, say so and ask one
  clarifying question instead of guessing.
- **`NO_QUERY`** → ask the user what they want to do; do not route.

Completion criterion: exactly one terminal branch completes — `MATCH` hands off
the table-selected skill, `NO_MATCH` hands off one evidence-backed classification
or asks one clarifying question, and `NO_QUERY` asks for a task description.

### Codex-mode rule (how `CODEX` shapes the invocation)

- **`CODEX=off` (default):** invoke the target codex-free.
  - One exception — `dhpk:feasibility-study` defaults codex-**on**, so pass
    `--no-codex` to it to honor the codex-free default.
- **`CODEX=on`:** append `--codex` when the target supports a codex mode —
  `dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev`. Special cases:
  - **Security** has no in-skill codex mode: route to the dedicated codex command
    instead — `dhpk:security-review` (default) → **`dhpk:codex-security`** under `--codex`.
  - `dhpk:feasibility-study`: invoke **without** `--no-codex` (its default already uses Codex).
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
  consult.
- **`PLAN=on`:** a pre-implementation `dhpk:planner` consult activates **only**
  when the resolved route target is one of the four implementation-class
  skills — `dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev`,
  `dhpk:opsx-apply-goal`. **Precedence:** if `OPENSPEC=on` and the resolved route
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

### Openspec-mode rule (how `OPENSPEC` shapes the invocation)

- **`OPENSPEC=off` (default):** invoke the target normally, no OpenSpec
  diversion.
- **`OPENSPEC=on`:** the artifact-then-review flow activates **only** when the
  resolved route target is one of the three **change-authoring** routes —
  `dhpk:adaptive-dev-workflow`, `dhpk:bug-fix`, `dhpk:feature-dev`. On those,
  instead of invoking the target skill:
  1. Invoke `opsx:new` then `opsx:ff` via the **Skill** tool
     (`openspec-new-change` → `openspec-ff-change`) to emit the change
     artifacts (proposal / design / specs / tasks) for the cleaned query. When
     the Architect-consult rule above fired for this task, fold the
     `dhpk:architect` conclusion into the change description handed to `opsx:new`.
  2. **Stop for human review** — do **not** proceed to implementation. State
     that the change awaits review and can be applied later with `/opsx:apply`
     (or an unattended `dhpk:opsx-apply-goal` session).

  Because this supersedes `--plan`, when `OPENSPEC=on` activates on a
  change-authoring route, **no** `dhpk:planner` consult runs even if `--plan`
  was also passed.

  Any other resolved route — **including `dhpk:opsx-apply-goal`**, which applies
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
Routing to /dhpk:adaptive-dev-workflow (adaptive dev workflow (bug)).

# NO_MATCH (classified from cheap repo signals)
No deterministic route; routing to /dhpk:verify because worktree is dirty and the request ("收尾") reads as a wrap-up.

# NO_QUERY (no task text given)
No task described — what would you like to do? (e.g. "fix the login bug", "review my branch")
```

User request: $ARGUMENTS
