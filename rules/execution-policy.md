# Execution Policy

dhpk's default execution policy for projects that adopt the harness. Resource-layer markdown — referenced from the `dhpk-execution-policy` skill and consumable directly by a project's own `CLAUDE.md` via the `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` path. Not auto-loaded; opt-in.

> Project overrides: projects that adopt this policy should keep their own short `.claude/rules/execution-policy.md` (or `CLAUDE.md` section) that only encodes deltas — e.g. extra sentinels, project-specific hot tables for performance reviewer, hook profile choice. Avoid copying the body wholesale; cross-link instead.

## Glossary (inline)

- **sentinel**: `.claude/artifacts/sessions/.pending-*` marker file (written by a post-edit hook; cleared by the reviewer's Closing hook via `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh`). Existence check: `find -maxdepth 1 -name '.pending-*' -print 2>/dev/null` (avoids shell-specific `nomatch` behaviour with bare globs). Unrecognized `.pending-*` strays (not in the SSOT — a typo or abandoned custom sentinel) have no clearing agent and would block the opsx-goal `NONE` gate forever; `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/reap-stale-sentinels.sh` surfaces them always and, with `--clear`, removes ones older than the threshold.
- **back-stop**: hook pattern did not match but the AI semantically recognises the trigger should fire → AI proactively invokes the matching reviewer (and still clears the sentinel if present).
- **append-only exemption**: pure additions (not modifying existing symbol body / signature / docblock) may skip `gitnexus_impact` — label the change `append-only — gitnexus_impact skipped`.
- **reviewer dispatch**: when multiple sentinels coexist, triage out false positives → dispatch the rest **in parallel** → `code-reviewer` merges/dedups (see "Reviewer dispatch").

## Task modes

| Task | Flow |
|---|---|
| Small change | inspect → patch |
| Small bug (known cause) | inspect → tdd-guide RED → patch → tdd-guide verify |
| Medium change | inspect → brief plan → tdd-guide → patch |
| Bug (unknown cause) | bug-investigation → tdd-guide → patch |
| New feature | tdd-guide → patch |
| Architecture change | architect → tdd-guide → patch |

## Classification-first context loading

Determine the workflow type (Small change / Bug / Feature / Architecture) from the user request BEFORE loading heavy references (profiles, scope docs, legacy analysis, investigation scaffolding). Load only the references the chosen workflow needs; expand incrementally if the classification changes. Upfront loading burns context budget on paths not taken. (adaptive-dev-workflow, harness-fill)

### Change classification & OpenSpec routing (SSOT)

Single source of truth for the six change types, their planning step, and whether to ask about OpenSpec. `commands/create-dev.md` and `skills/adaptive-dev-workflow/SKILL.md` route through this table — reference it, do not restate it.

| Change type | OpenSpec ask? | Planning step → path |
|---|---|---|
| Bug Fix (unknown root cause) | ✅ ask | `bug-investigation` → y: `/opsx:new` · n: brief plan → patch |
| Feature Delivery (cross-module / DDD) | ✅ ask | `dhpk:architect` → y: `/opsx:new` · n: brief plan → patch |
| Feature Delivery (normal) | ✅ ask | y: `/opsx:new` · n: brief plan → patch |
| Bug Fix (known root cause) | ❌ no | inspect → patch |
| Medium change | ❌ no | brief plan → patch |
| Lightweight Maintenance | ❌ no | Read → Edit |

## Agent dispatch

Agents run via the `Agent` tool (`subagent_type=<name>`), not via skill names.

| Agent | Trigger |
|---|---|
| `tdd-guide` | Feature / bugfix, **before** writing implementation |
| `architect` | Cross-module or DDD-layer design |
| `database-reviewer` | SQL / Repository / migration (SQL correctness) — sentinel `.pending-db-review` or back-stop |
| `migration-reviewer` | Migration files (up/down symmetry, FK naming, large ALTER, multi-tenant deploy) — sentinel `.pending-migration-review` (opt-in 6th slot; not in dhpk's default 5-slot review_agents until v0.5.x) |
| `security-reviewer` | Auth / crypto / money / file upload — sentinel `.pending-security-review` or back-stop |
| `performance-analyzer` | Repository methods on high-volume tables — back-stop only |
| `frontend-reviewer` | JS / TS / view-layer JS — sentinel `.pending-frontend-review` or back-stop |
| `code-reviewer` | **Code final gate** — sentinel `.pending-review` |
| `doc-reviewer` | **Doc final gate** — sentinel `.pending-doc-review` |

Agent names above are dhpk defaults; override via `userConfig.review_agents` per slot. Projects with prefixed agents (e.g. `code-reviewer-<project>`) configure the override in their `settings.local.json`.

**Diff-scope mandate (all reviewers)**: reviewers audit the UNCOMMITTED working tree (`git diff --staged` + `git diff HEAD`), never committed history (`git diff <base>...HEAD` / merge-base diff). Under the no-auto-commit workflow the change-under-review sits uncommitted; a base-relative diff reviews the whole branch (often hundreds of files) — wasting tokens/time and misreporting committed-but-superseded code as unfixed. Orchestrators dispatching a reviewer MUST NOT instruct it to diff against a base branch unless an explicit full-branch/PR review is the intent.

**Model tier**: reviewers run at their agent-frontmatter default (`doc-reviewer` = haiku, the rest = sonnet). For a **HIGH-risk diff** — `security-reviewer` on auth/crypto/money/upload, or `migration-reviewer` on a multi-tenant schema change against a high-volume table — the orchestrator MAY raise that single dispatch to opus via the `Agent` call's `model` param. Default stays sonnet; escalate by judgment, not by default (cost).

## Multi-AI / dual-perspective independence

When a step uses a second AI or a second perspective (Codex, Gemini, or a Claude-vs-Codex/dual-view pass), each side MUST form its own conclusion from the source — never feed Claude's findings, verdict, or theory into the secondary prompt.

- Secondary prompt carries only the question + project path + stack — not Claude's analysis.
- No leading questions ("I think it's the cache, confirm"), no scope pre-filtering, no reused threads.
- Compare the two independent conclusions; flag divergences explicitly in the report.

Violation: the secondary AI confirms instead of verifying → false consensus that masks the shared blind spot. Applies to codex-architect / -brainstorm / -implement / -code-review, multi-ai-sync, feature-verify, test-review, code-investigate, issue-analyze.

## Mandatory post-steps

### Post-implementation agent gate (SSOT)

Every path except Lightweight Maintenance runs these four agents in order after the last Edit/Write; each must PASS before the next. This is the canonical gate — `commands/create-dev.md`, `skills/adaptive-dev-workflow/SKILL.md`, and the opsx-goal flow reference it rather than restating.

| # | Agent | Runs when |
|---|---|---|
| 1 | `dhpk:tdd-guide` | bug fix or new feature (before writing implementation) |
| 2 | `dhpk:database-reviewer` | change touches SQL / database |
| 3 | `dhpk:security-reviewer` | change touches auth / authz / crypto / money / upload |
| 4 | `dhpk:code-reviewer` | always — final step after any Edit/Write |

Gate failure → fix → re-run that gate → continue only on PASS. Never skip. (The sentinel machinery below operationalizes gates 2–4; `tdd-guide` has no sentinel — see the AI-judgment back-stop.)

### Hook-enforced (sentinels)

Trigger map source-of-truth: dhpk's `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/post-edit-dispatch.sh` (7 default slots: code, db, security, frontend, doc, polyfill, migration) plus any per-module post-edit hooks contributed by enabled modules. Each sentinel is cleared by the agent's Closing hook (`clear-sentinel.sh <name> <label>`).

| Sentinel | Required agent | Trigger summary (default; project can extend via `userConfig.review_trigger_extra_paths`) |
|---|---|---|
| `.pending-review` | `code-reviewer` | `*.php` / `*.js` / `**/CLAUDE.md` |
| `.pending-doc-review` | `doc-reviewer` | `.claude/{agents,rules,commands,hooks,scripts,skills,manifests}/**/*.{md,sh,json,yml,yaml}` — covers both frontmatter schema (name/model/tools) for `.md` DSL artifacts AND cross-file SSOT / link-validity |
| `.pending-db-review` | `database-reviewer` | Repository / migration / model / `*.sql` |
| `.pending-security-review` | `security-reviewer` | Controllers / config / `*{Auth,Login,Acl,Upload,File}*.php` |
| `.pending-frontend-review` | `frontend-reviewer` | JS / TS (vendor / ignored paths excluded) |
| `.pending-polyfill-review` *(library-author module)* | `polyfill-reviewer` | `.php` edits with a runtime version guard (`version_compare` / `class_exists` / `method_exists` / `InstalledVersions::*`) |
| `.pending-migration-review` *(opt-in slot)* | `migration-reviewer` | Migration files (e.g. `**/migrations/**/*.php`) — projects that wire this sentinel in their post-edit hook get migration-specific review on top of the standard db-review |

Skipped paths: openspec/**, docs/**, plain .md outside .claude/, .claude/{memory,artifacts,worktrees}/. See your hook source for the exact list.

### Reviewer dispatch (when multiple sentinels coexist)

At the end of a turn that produced Edits/Writes, gather ALL pending sentinels, then **triage → dispatch in parallel → merge**:

1. **Triage first (cheap, no agent).** Look at the diff scope and DROP false-positive sentinels before dispatching — a pure-style CSS tweak, a single-string / comment-only / whitespace-reflow change does not warrant a full reviewer (e.g. a 2-line CSS change must not pull in `security-reviewer`); a typo-fix or pure-formatting `.md` change does not warrant `doc-reviewer` (it fires for substantive policy/SSOT changes, not cosmetics). Clear each dropped sentinel via its Closing hook with a one-line reason. Triage only **drops**; when in doubt, keep the reviewer.
2. **Dispatch the surviving reviewers IN PARALLEL** — one message, multiple Agent calls. Each reviewer audits only its own concern and is independent, so wall-clock is `max(reviewers)`, not the sum. Do **not** run them as a sequential chain.
3. **`code-reviewer` is the merge/dedup owner.** When it is in the dispatched set, `code-reviewer` (or the orchestrator on collecting the parallel results) merges all findings and removes cross-reviewer duplicates — this replaces the old "sequential order de-dups" mechanism. Each specialist still owns its lane (code-reviewer does not re-run OWASP / SQL / link-checks; frontend-reviewer does not re-run SQL; doc-reviewer does not audit code quality).

- Each reviewer **only handles its own sentinel**: missing sentinel → skip; present (and not triaged out) → it MUST run (back-stop excepted).
- **Batched per turn, not per edit**: a turn with N Edits runs each reviewer at most once, after the last edit — never once per Edit.
- **CRITICAL handling under parallel dispatch**: collect every parallel verdict, then if any reviewer returns CRITICAL → surface it and block the merge/commit. (Parallel means all reviewers run regardless of another's CRITICAL — independent concerns are not short-circuited.)
- `code-reviewer` and `doc-reviewer` **are not mutually exclusive**: mixed diffs (PHP + .sh + plain `.claude/` policy doc) dispatch both. Single-type diffs dispatch only the matching one.
- Pure research / planning (no Edit/Write) skips all reviewer agents.

### Review output gate

Every quality-gate reply (code / doc / test / security review, audit, risk-assess) ends with an explicit gate: a symbol (✅ pass / ⚠️ conditional / ⛔ block), a status word (Mergeable / Needs revision / Adequate / Insufficient / Inconclusive), and a one-line justification. The gate is the decision — reader sees the symbol first. Example: `✅ Mergeable — all dimensions ≥4/5, no P0 findings.` (pr-review, doc-review, test-review, security-review, project-audit, risk-assess)

### AI-judgment back-stop (self-trigger)

Semantically matches but path pattern did not trigger a sentinel → self-trigger:

- New feature / bugfix in business layer → `tdd-guide` **before** writing implementation.
- Money / crypto / cert / token paths not matched by hook patterns → `security-reviewer`.
- Repository methods on high-volume tables (each project declares its own hot tables via the `hot_tables` userConfig key or its CLAUDE.md / rules — names like `orders` / `records` / `stock` are POS-system examples only) → `performance-analyzer`.
- Editing `<script>` blocks inside view-layer template files (PHP / ERB / Twig / Razor) → `frontend-reviewer`.
- New / changed domain type, value object, enum, or struct with non-trivial invariants ("make illegal states unrepresentable") → `type-design-analyzer` (also a `code-reviewer` delegate).
- Deep error-handling audit (empty catch / swallowed exceptions / hidden fallbacks / missing rollback) → `silent-failure-hunter` (also a `code-reviewer` delegate).
- Structural change (new module / renamed dir / new public service or API surface) → `doc-updater` (it runs `/update-codemaps` + `/update-docs`).
- Needing current / up-to-date library / framework / API docs mid-task → `docs-lookup` (Context7).
- Cleanup beyond a single file — a file > 800 lines to split, cross-file duplicate logic, or a multi-module dead-code sweep → `refactor-cleaner` (use `/simplify` for in-place single-file work).
- Brownfield project with empty `openspec/specs/` + a spec-extraction request → `spec-miner` (or the `/spec-mine` front door).
- `swift build` / `xcodebuild` / SPM resolution failure → `swift-build-resolver` (swift / xcode-tooling module active).
- `ruff` / `mypy` / `pytest-asyncio` (and `pyright` / `pytest` / `uv sync`) error appears in Bash output → `python-build-resolver` (python / fastapi / pytest module active).
- `cargo build` / `cargo test` rustc (or `cargo clippy`) error appears in Bash output → `rust-build-resolver`.
- Editing version-specific dirs (`src/Laravel/`, `src/Symfony/`), composer version constraints, or `.github/workflows` CI matrices, or before tagging a release → `version-matrix-impact-reviewer` (library-author module).

> **Why view-layer script doesn't go through the hook**: `post-edit-dispatch.sh` uses path-pattern matching (O(1)). Detecting `<script>` blocks would require reading the full PHP file content on every Edit (grep cost asymmetric to the edit cost). Per the trigger taxonomy, view templates don't all contain `<script>`; AI looking at the diff has near-zero recognition cost, so back-stop is sufficient.
>
> **When to upgrade to hook**: once a project accumulates ≥3 missed-review cases (feature shipped to prod), or view-layer JS bug ratio significantly exceeds the JS-file leaf ratio, then add path+content grep to the hook. Until then, AI judgment.
>
> **`tdd-guide` has no sentinel.** `.pending-tdd` is never written by any hook (tdd-guide is pre-edit, not post-edit), so it is reached only via the back-stop above or an explicit pre-implementation invocation — it is **not** auto-enforced by the `opsx-goal` universal `ls .pending-*` gate. For unattended `opsx-goal` runs, new-code testing is enforced as an *outcome* by the **coverage gate** when the project has a coverage threshold configured (see `skills/opsx-goal/references/detection.md` `HAS_COVERAGE`); where no threshold exists, tests-first must be carried by the change's tasks/plan (authored via `feature-dev`), not assumed from the sentinel gate.

## Pre-plan checklist (Feature / Bug)

1. `claude-mem smart_search "<module or symbol>"` — past decisions (if claude-mem is installed)
2. Spawn Explore agents with `cx` instructions (→ `${CLAUDE_PLUGIN_ROOT}/rules/tool-routing.md`)
3. `gitnexus_impact({ target, direction:"upstream" })` after the target symbol is identified (if gitnexus is installed)
4. Database work → verify Repository routing via the project's query builder convention

## Deterministic first, judgment second

For audit / setup / inventory / generation work, separate fact-collection from interpretation:

1. **Collect deterministically** — scripts / Grep / Glob only, no AI judgment. Establish a baseline and surface any pre-existing failure before stacking new changes on it.
2. **Gate** — present the collected facts; for destructive or multi-file outcomes, wait for user confirmation before the judgment phase.
3. **Judge** — only then apply AI evaluation, scoring, or proposals.

**Tool output is immutable**: invoke the deterministic tool, forward its stdout verbatim. Never hand-construct or post-process contract output (e.g. `deploy-list` schema=v1); if a tool fails, stop and report — do not simulate its output.

(harness-revise, skill-stocktake, project-setup, project-audit, risk-assess, deploy-list, skill-scout)

## Self-check (before reply)

Wrap-up before reply / after a large Edit / before smart-commit → load `dhpk:execution-checklist` skill for the full self-audit (Per-reply / Conditional / Task-end three-stage + trigger-condition matrix). Daily single-line edits / pure research / typos do not need this.

Any applicable NO → fix first, then reply.

## Anti-rationalization

Before skipping any sentinel / TDD / reviewer mandated step, load `${CLAUDE_PLUGIN_ROOT}/rules/anti-rationalization.md` for self-rebuttal. On-demand load, not always-on. Trigger conditions (full table in that file):

- Task mode judged "Small change" but diff exceeds 30 lines
- Wanting to skip the reviewer corresponding to any sentinel
- Wanting to invoke §0 append-only exemption
- Wanting to claim completion via "verify skill passed" without a test diff
- Three consecutive entries in judgment-retrospective memory flag the same bias

## Git pipeline

`feat|fix|docs|refactor/*` → `develop` → `master` (or your equivalent branching model). Standard flow: feature branch → `/codex-review-fast` → `/precommit` → `/pr-review` → PR. dhpk does **not** auto `git add/commit/push/stash` — invoke `/smart-commit` or `/precommit`.

### Squash merge hygiene (recommended)

For squash-merge PRs (collapsing multiple feature-branch commits into a single commit on the integration branch), the PR description should include an `## Unrelated Changes` section listing variations not directly tied to the PR's stated feature (file paths, line count, why mixed in, assigned reviewer). Reformats / CI yml tweaks / README typos **don't count** as unrelated; new controller actions / new services / schema changes / cron jobs / private→protected refactors / service factory extractions **do count**.

The `pr-review` skill includes an optional `check-unrelated-changes.sh` script (advisory, not blocking).

## Anti-loop & output

**Stop and escalate** when ANY holds (not just the first): same failure 3×; no
progress across two consecutive checkpoints (edits/tool-calls produce no change in
the failing signal); repeated failures with the *identical* error / stack trace;
cost or context drifting outside the budget window; a blocking merge conflict that
keeps recurring. On stop, report (1) what was tried + error, (2) ≥2 alternatives,
(3) recommended next step.

**Before any autonomous / repeated loop**, confirm the safety floor exists: a
quality gate is active (lint/test), a known-good baseline to diff against, a
rollback path (clean git state / revert), and branch or worktree isolation. Missing
any → set it up first or do the work non-autonomously.

**Review-loop ceiling (Codex auto-loop skills only)**: distinct from the general "same failure 3×" stop above — this is a hard per-sentinel counter for skills that auto-loop fix→re-review via Codex (doc-review, test-review, security-review), capped at **3 rounds per sentinel**. On round 4, stop and report the blocker for human review — do not retry the same finding.

Output: `Conclusion → Changed files → Verification → Risks/Open questions`. Blocked: `Blocker → Tried → Next viable option`.

## Testing

Run the project's standard test suite + browser verify (playwright-cli, manual, or stack-equivalent). For Docker projects: see your `${PHP_CONTAINER:-php}` workflow. Commands per stack live in the matching dhpk module reference (e.g. `modules/phpunit-5.7/references/testing.md`).

## Component-addition gate (new agent / sentinel slot / hook)

Adding a reviewer agent, sentinel slot, or hook is the add-then-remove churn that leaves residue (dead slot tokens, orphan sentinels, drifted counts). Before adding one, document in the relevant INDEX (`agents/INDEX.md`, `skills/INDEX.md`, or the hook's header comment) **why an existing component cannot cover the need** — name the agent/slot/hook considered and the specific gap it leaves. A new component with no recorded justification is rejected in review. Removal is symmetric: in the same change, delete its INDEX row and every reference (slot token, `.pending-*` literal, count claim), so nothing is orphaned — the sentinel-integrity and count guards (`tests/sentinel-slots.test.js`, `scripts/ci/catalog.js`) enforce this mechanically.
