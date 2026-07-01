# Changelog

## 0.20.1 — 2026-07-01 — Post-implementation agent gate SSOT, route-table consolidation, harness validation hardening

Maintenance release — no new agents or behavior changes for end users. Internal
harness cleanup and test coverage additions only.

**docs(rules)** — Post-implementation agent gate:
- Established `rules/execution-policy.md` as the single source of truth for
  the post-implementation reviewer-agent gate; `commands/create-dev.md`,
  `skills/adaptive-dev-workflow/SKILL.md`, and `skills/pr-review/SKILL.md`
  now reference it instead of duplicating the rules.
- Added `skills/INDEX.md` — navigable index of installed skills.

**chore(scripts)** — Route-table and validation hardening:
- Consolidated task-routing rules in `scripts/lib/route-table.json` and
  `commands/do.md`.
- `scripts/validate/validate-harness.sh` and `scripts/ci/catalog.js`
  strengthened for stricter static validation of the harness catalog.

**test** — Integration coverage:
- Added `tests/catalog-claims.test.js` and `tests/sentinel-slots.test.js`
  covering catalog claim accuracy and the 7-slot sentinel model.

**chore(config)** — Plugin description and README bilingual sync.

**fix(docs)** — Fixed a pre-existing MD038 markdownlint violation in
`skills/opsx-load-context/SKILL.md` (space inside a code span) that was
blocking CI.

## 0.20.0 — 2026-06-30 — Python/Rust build-resolvers, doc-reviewer absorbs artifact validation, route-table bilingual convergence

Agent count 22 → 24. Artifact-reviewer merged into doc-reviewer (7-slot
sentinel model preserved). Route-table and `do` command simplified. opsx
apply-resume flow improved.

**feat(agent)** — Two new build-resolver agents:
- `python-build-resolver` — diagnoses and fixes Python toolchain failures
  (ruff/pyright/mypy/pytest/pytest-asyncio/uv sync). Three-attempt cap;
  escalates to code-reviewer on success.
- `rust-build-resolver` — diagnoses and fixes Rust/Cargo failures (rustc
  type/borrow/lifetime errors, trait-bound / Send+Sync errors, async/tokio,
  macro errors, Cargo.toml version conflicts). Same three-attempt cap.

**refactor(agent)** — `doc-reviewer` absorbs artifact-reviewer scope:
- `.md` DSL artifacts with YAML frontmatter (agent / skill / command / rule
  files) are now reviewed under the existing `doc-reviewer` sentinel — no
  additional slot required.
- Standalone `artifact-reviewer` agent removed; 7-slot sentinel model preserved.

**refactor(hook)** — Sentinel hook cleanup:
- Experimental 8th sentinel slot (artifact) removed; back to canonical 7 slots
  (code / db / sec / frontend / doc / polyfill / migration).
- Removed artifact-reviewer hook and stale rules.

**refactor(router)** — Route-table bilingual convergence:
- Bilingual (zh/en) route rules converged into a single unified table.
- `do` command logic simplified; dead rule branches pruned.

**refactor(opsx)** — apply-resume flow:
- Recovery and storage flow in `opsx-goal` apply-resume optimised.

## 0.19.0 — 2026-06-29 — ECC agent port: 4 new agents, trap-sheet harvest, reachability wiring, opsx coverage gate

ECC sibling-project content ported into dhpk across four passes. Agent count
18 → 22. Existing single stack-aware reviewer model preserved; ECC per-language
reviewer content harvested into `agent-traps/` instead of creating new agents.

**feat(agent)** — Four new manual-invoke agents:
- `spec-miner` (Opus) — brownfield spec extraction → `openspec/specs/`; paired
  with new `/spec-mine` command.
- `type-design-analyzer` — data-model / type-system review; dispatched from
  `code-reviewer` Delegate table.
- `agent-evaluator` — 5-axis agent-quality scorecard; wired to `skill-judge`
  and `harness-govern` family only, kept out of dev routing.
- `e2e-runner` — Playwright E2E runner; `skills: ["playwright-cli"]` like
  `ui-ux-verifier`; dispatched from `post-dev-test` and E2E routing rules.

**feat(trap)** — New trap sheets harvested from ECC:
- `code-reviewer/{python,js,vue,fastapi}.md` — stack-specific reviewer traps.
- `security-reviewer/{python,js}.md` — severity-anchor table, emergency
  response protocol, JS/Vue stack detection.
- `database-reviewer/postgres.md` — Postgres-specific query traps + engine
  detection clause in `database-reviewer.md`.
- `performance-analyzer/{frontend,swift}.md` — broadened beyond relational-only.
- `tdd-guide/js.md` — JS-specific edge-case catalog.
- `_common/prompt-defense.md` already present (shipped in 0.18.0).

**feat(agent-baseline)** — Baseline enrichment across agents:
- `architect.md` — 8-name anti-pattern catalog, build-order bullet, reject
  & re-slice plan gate.
- `tdd-guide.md` — fuller edge-case catalog + `js` detection wiring.
- `refactor-cleaner.md` — dead-code "what counts as removable" checklist.
- `commands/simplify.md` — 3-category simplification checklist.
- `code-reviewer.md` — model-cost-tier bias surfaced as MEDIUM finding.
- `security-reviewer.md` — severity-anchors table + emergency response section.

**feat(routing)** — Agent reachability wiring for 8 previously orphaned agents:
- `rules/execution-policy.md` — AI-judgment back-stop list (8 bullets).
- `commands/spec-mine.md` — new thin command dispatching to `spec-miner`.
- `commands/simplify.md` — `Agent` added to allowed-tools for `refactor-cleaner`
  dispatch.
- `scripts/lib/route-table.json` — dead-code regex scoped to explicit removal
  verbs so "review dead code" no longer routes to simplify.

**feat(opsx)** — opsx-goal reliability fixes:
- **Coverage gate** — opt-in outcome gate; `detection.md` += `HAS_COVERAGE`
  section (true only when project has a configured fail-threshold: jest
  `coverageThreshold` / phpunit `<coverage>` min / pytest `--cov-fail-under` /
  swift). `SKILL.md` Step 6 emits coverage via runner's own `--coverage`
  invocation when active. Never invents a threshold.
- **`--min-coverage N`** — CLI flag to override the coverage threshold at
  invocation time (opt-in, logged to Block A).
- **Stray-sentinel reaper** — `scripts/hooks/reap-stale-sentinels.sh` hardened
  with an unknown-stray pass: warns always, `--clear` removes strays older than
  threshold (age-gated). `opsx-goal` Block C pre-flight now runs reaper with
  `--threshold-minutes 60 --clear`. `clear-sentinel.sh` whitelist-rejects unknown
  names.

**feat(workflow)** — `adaptive-dev-workflow`: description and openspec error
handling improved.

**docs** — Harness health-check / governance guide, spec-extraction guide, and
E2E test writing guide added to README files.

## 0.18.0 — 2026-06-29 — CI quality gate, opsx hang-detection, prompt-injection defense, reviewer trap enrichment

First PR-level harness quality gate modelled on ECC's `scripts/ci/` pattern,
plus opsx long-task hang monitoring, prompt-injection defence baseline, and
enriched reviewer trap sheets.

**feat(ci)** — Added `.github/workflows/ci.yml` (validate + non-blocking markdown
lint). Added five zero-dependency Node validators
(`scripts/ci/validate-{agents,skills,commands,modules,plugin}.js`) with shared
`_lib/frontmatter.js` + `_lib/report.js` (WARN default / `--strict` flag).
Added `scripts/ci/catalog.js` (count SSOT, `--check`/`--write`) — used to catch
and fix plugin.json "17 role-based agents" description drift (actual 18).
Fixed `scripts/validate/validate-harness.sh` for dual-mode validation (repo
source root `agents/ skills/ commands/ rules/` + `scripts/hooks/`, not the
installed `.claude/` layout).

**test(harness)** — Added `tests/` directory with `tinytest` zero-dependency
runner and three suites: `plugin-manifest`, `module-catalog`, `hooks-wiring`.

**feat(opsx)** — `skills/opsx-goal/SKILL.md`: added wall-clock hang-detection
(`detection.md` reference), timeout resume-note output guidance, and context-
loading chain integration. `skills/opsx-load-context/SKILL.md`: wired into the
resume-note pipeline.

**feat(router)** — `commands/do.md`: improved repo-signal disambiguation for
smart routing; added `opsx-goal` routing rule to `scripts/lib/route-table.json`.

**feat(security)** — Added `agent-traps/_common/prompt-defense.md` (Prompt-
Defense baseline). Applied to `security-reviewer`, `doc-reviewer`,
`docs-lookup`, and `ui-ux-verifier` agents.

**feat(review)** — Enriched PHP and Swift `code-reviewer` trap sheets with
worked real-world examples and false-positive filtering guidance. Added AI code
review metrics section to `security-reviewer` iOS / PHP / Yii trap sheets.

**fix** — chmod +x on 4 hook scripts that shipped without execute permission
(`check-plugin-version.sh`, `post-edit-manifest-guard.sh`,
`pre-agent-warmstart.sh`, `stop-completion-evidence.sh`). Removed dangling
`phpunit-batch-refactor` skill reference from `modules/phpunit-5.7/module.yaml`.
Added `.markdownlint.json` for consistent Markdown lint config.

## 0.17.0 — 2026-06-27 — skill audit: format/content hardening, oversized splits, wiring fixes

Full health-check of every skill (necessity, relationships, format, content
correctness) plus reconstruction of documented-but-unbuilt helper infrastructure.

**fix(skill-lint)** — `skill-lint.js` now (1) accepts namespaced MCP tool names
(`mcp__server__tool`, including hyphenated segments) instead of flagging valid
`mcp__gitnexus__*` / `mcp__context7__*` agent tools as "non-canonical" (16 false
positives removed), and (2) discovers skills **recursively**, so the 6 nested
`skills/gitnexus/*` skills are linted for the first time.

**fix(skills) — format / routing** — Cleared all P1/P2 routing & structure
findings across ~40 skills: added missing `When NOT to Use` / `Output` /
`Verification` sections, strengthened description routing signatures, and added
`Agent` / `Task` to `allowed-tools` where dispatched.

**fix(skills) — latent loader bugs** — Three description classes that broke under
strict YAML are now single-quoted: the 6 `gitnexus/*` descriptions
(double-quote-wrapped with backslash escapes → literal quotes), and
`swift-test-strategy` / `phpunit-10-notes` (unquoted ` #[…]` / ` #expect`
truncated the description at the `#`).

**fix(skills) — content correctness** — Corrected version-fact errors found in
deep review: laravel-6 (fabricated "extracted packages" list → the real
`laravel/ui` extraction; removed a non-existent `RetrievedUser` event and a
mis-dated `MustVerifyEmail` change), laravel-10 (broken Faker entry with
identical before/after), laravel-5.4 (route-model-binding / middleware-groups
re-dated to their real 5.2 origin), phpunit-9 (Prophecy deprecated in 9, removed
in 10 — was "removed in 9"), phpunit-10 (`CovesClass` typo). `feasibility-study`
dispatched a non-existent `feasibility-analyst` agent → repointed to
`general-purpose`.

**fix(skills) — Context7 fact validation** — Cross-checked every
language/framework skill's version-specific claims against Context7 docs
(Laravel 6.x/8.x/11.x branches, PHPUnit, php.net, FastAPI/SQLAlchemy/pytest/Ruff,
ESLint/TypeScript/Vue) plus the authoritative PHPUnit changelog. PHP, Python, JS
and Vue facts came back clean; further corrections: **phpunit-11** doc-comment
annotations are *deprecated in 11, removed in 12* (the skill wrongly said "fully
removed in 11" throughout) and the Rector set is `PHPUnitLevelSetList`
(was the non-existent `PHPUnitCodeQualityLevel`); **phpunit-9** Prophecy's
replacement is a `ProphecyTrait` (not a base class); **TestListener** deprecation
re-dated to 7.3 consistently across the 9/10 skills; **python-pro** PEP 585
builtin generics re-dated to 3.9 (was 3.10); **laravel-6** gained the Carbon-2
requirement note; **laravel-11** "Backport classes" wording corrected;
**laravel-package-author** dropped a false "Laravel 11 no longer recommends
deferred providers" claim; **laravel-testbench-matrix** "−2 offset" note fixed.
Apple-SDK facts (Swift/iOS) are thinly covered by Context7 and were left as-is
where unverifiable.

**refactor(skills) — oversized splits** — Split 5 over-budget skills into
`references/` (content moved, not lost): skill-judge 753→141, project-setup
554→179, create-request 464→183, continuous-learning-v2 363→170, claude-health
335→148.

**feat(scripts) — build documented-but-missing helpers** — Implemented helpers
that skills referenced but that never existed in git: `scripts/run-skill.sh`
(skill helper-script runner, used by 6 skills), `scripts/emit-review-gate.sh`
(review-gate marker), and the feature-context resolver
`scripts/lib/feature-resolver.js` + `scripts/resolve-feature-cli.js` +
`scripts/resolve-feature.sh` (the documented 4-level cascade, slug-validated,
`execFileSync`-safe).

**fix(skills) — dangling references** — Inlined the never-built `seek-verdict`
verdict-prompt + thresholds into `issue-analyze` and `codex-code-review`
(self-contained now); repointed `test-driven-development` → the `tdd-guide`
agent (4 files); fixed the `smart-commit` command to reference the
`git-smart-commit` skill.

**chore(skills) — retire** — Removed `contract-decode` (EVM decoder, out of
stack) and `phpunit-batch-refactor` (project-specific completed-migration
artifact), and cleaned their inbound references.

Validation: root + every module lint clean (0 P0/P1; residual P2 are intentional
reference-length line counts), `validate-harness.sh` + `test-hooks.sh` green.

## 0.16.2 — 2026-06-27 — module skill description trim (issue #12 interim)

**docs/perf(skills)** — Interim mitigation for
[#12](https://github.com/hmj1026/dhpk/issues/12): module skill `description:`
fields are statically registered for **every** shipped module regardless of the
`modules` option (a Claude Code plugin-manifest limitation — `modules` gates
hooks / path triggers / the SessionStart activation line, **not** the skill
listing; `skillOverrides` can't hide plugin skills either), so a single-stack
project still pays the description-token cost of every other stack. Refactored the
13 over-long module skill descriptions to the `create-skill` / `skill-judge` D4
convention — stripped redundant prose while preserving every routing trigger
(framework / version names, `Use when…`, counterpart / `Not for` fences) —
trimming the module-skill description surface from **18,886 → 18,034 chars
(−852)**. `/check-skill` per-skill status is byte-identical before/after (no
routing regression). Also documented `skillListingBudgetFraction` (README Modules
+ Troubleshooting, `harness-govern` caveat) as the file-level lever, and corrected
the README / `harness-govern` wording that implied module-gating hides skills. The
architectural fix (per-ecosystem plugin split / installer-driven per-project skill
provisioning) remains tracked on #12.

## 0.16.1 — 2026-06-27 — statusline 1M-context usage fix

**fix(statusline)** — The global statusline defaults `context_window_size` to
200000, so a 1M-context model (model id carries a `[1m]` suffix, e.g.
`claude-opus-4-8[1m]`) reading ~192k tokens displayed **96%** instead of ~19%.
`scripts/statusline/statusline.sh` now injects `context_window_size=1000000`
when the model id matches `[1m]` before delegating to the global statusline,
with a `python3` fallback for the jq-less path. No behaviour change for
200k-context models.

## 0.16.0 — 2026-06-27 — harness-* family consolidation (BREAKING)

Consolidates the `harness-*` command / skill / agent family into one coherent set
behind a single front door (`/harness-govern`), removes a redundant scorecard
path, and brings token accounting under the `harness-*` brand. No behaviour change
beyond the two renames/removals below.

**BREAKING — agent removed (`harness-optimizer`)** — its broader
reliability/cost/throughput scorecard overlapped both the deterministic
`/harness-audit` script and `/harness-govern`'s conform step. That judgment is now
folded into `/harness-govern`'s conform step as an explicit **five-leverage-area
scan** (hooks / evals / routing / context / safety) that proposes changes but
still delegates edits to `/harness-revise`. Anything that invoked
`harness-optimizer` directly should call `/harness-govern` (read-only) instead.

**BREAKING — skill renamed (`context-budget` → `harness-budget`)** — the token
audit joins the `harness-*` family as its token-accounting member and backs
`/harness-govern`'s measure step. Update any `/context-budget` invocations to
`/harness-budget`. Behaviour is unchanged.

**docs / routing** — `commands/INDEX.md` gains a harness-family decision tree and
marks `/harness-govern` as the single front door (build → `/harness-fill`,
score → `/harness-audit` | `/harness-budget`, trim → `/harness-revise`, full loop
→ `/harness-govern`). `agents/INDEX.md` (19→18 agents), README agent counts
(18→17 root), the `harness-reviser` cross-references, and the bootstrap design
spec/tasks are annotated to match. `plugin.json` drops the `harness-optimizer`
registration and bumps to 0.16.0.

## 0.15.0 — 2026-06-26 — new opsx-goal skill: unattended OpenSpec implementation sessions

**feat(skills)** — New `opsx-goal` skill. Given an OpenSpec change-id, it reads the
change's `tasks.md` + `proposal.md`, detects the test-runner scope, calculates a
turn budget, and emits a tailored `/goal` condition plus the `/opsx:apply` sequence
ready to paste into a fresh session — so Claude can drive an OpenSpec change to
completion unattended. Complements the existing `opsx-archive` / `opsx-verify` /
`opsx-sync` family. `commands/INDEX.md` updated with the new entry.

## 0.14.0 — 2026-06-26 — harness structure refactor: agent-traps, hooks _lib, harness-fill skill, create-skill

Structural refactor across agents, hooks, commands, and skills — no new measurement
or orchestration logic, but all four layers are now cleaner and more maintainable.

**refactor(agent)** — Language- and framework-specific trap tables extracted from
inline agent descriptions into a dedicated `agent-traps/` directory. Agent `.md`
files now stay short and stable; trap content can evolve independently.

**refactor(command)** — Standalone per-command description files removed; all
routing and setup metadata is now consolidated into the unified route table and
setup config. Reduces the per-command maintenance surface.

**refactor(hooks)** — Shared lifecycle hook utilities extracted into `hooks/_lib/`.
`lifecycle.sh` and related scripts refactored to source from `_lib/`; test suite
updated to match. Eliminates duplicated shell fragments across hook scripts.

**refactor(skills) — breaking rename** — `goal-ex` skill renamed to `harness-fill`
(better reflects that it fills in harness boilerplate rather than running goal
extraction). Update any `/goal-ex` invocations to `/harness-fill`. New
`create-skill` skill added: scaffolds a new skill directory with correct
frontmatter and `SKILL.md` boilerplate.

**chore(config)** — `plugin.json` gains `homepage` field; `php_cs_fixer_bin`
description tightened. Release workflow and metadata updated.

**chore(rules)** — Rules updated to reference `harness-fill`; tool-routing
guidance fine-tuned.

## 0.13.0 — 2026-06-26 — add /harness-govern audit→fix orchestrator

New `/harness-govern` command: a single thin orchestrator for the harness
governance loop — **measure** (delegates to the `context-budget` skill +
`/harness-audit` script), **conform** (the one net-new layer: judges results
against the official Claude Code best-practices checklist + known caveats such
as `skillOverrides` not applying to plugin skills, account-level claude.ai
connectors, and `skillListingBudgetFraction` as the only file-level truncation
lever), **fix** (only with `--fix`; routes to `/harness-revise --apply`), and
**verify**. Read-only by default so it is safe to `/loop`; mutating only on
`--fix`. Adds **zero** new measurement logic and does **not** merge the existing
specialists — it sequences them and the specialists stay the SSOT. Cross `See
also` links added to `/harness-audit`, `/harness-revise`, and the
`context-budget` skill; indexed in `commands/INDEX.md`.

## 0.12.4 — 2026-06-26 — reviewers audit the uncommitted working tree only

A reviewer dispatched with a base-relative diff instruction (`git diff
master...HEAD`) reviewed the **entire feature branch** (hundreds of files)
instead of the change at hand, and — because under the no-auto-commit workflow
the fix sat uncommitted in the working tree — reported already-superseded
committed code as unfixed. This release makes the working-tree scope explicit so
the behaviour no longer depends on the caller's prompt phrasing.

**Fixed — reviewer diff scope:**
- `agents/code-reviewer.md` / `agents/doc-reviewer.md`: the change-discovery step
  now mandates auditing the UNCOMMITTED working tree (`git diff --staged` +
  `git diff HEAD`) and forbids `git diff <base>...HEAD` / merge-base diffs.
  Only when both diffs are empty does it fall back to `git log --oneline -5` for
  context (not for review). A caller asking for a base-relative diff is treated
  as the working tree unless an explicit full-branch / PR review is intended.
- `rules/execution-policy.md`: added a **Diff-scope mandate (all reviewers)**
  note under the agent dispatch table — reviewers audit the working tree, never
  committed history; orchestrators must not instruct a base-branch diff unless a
  full-branch / PR review is the intent.

Consumers: run `claude plugin update` to pick up the new tag.

## 0.12.3 — 2026-06-25 — hook-level triage automation + harness-revise script fixes

0.12.2 shipped triage as an orchestration rule (the assistant drops
false-positive sentinels at dispatch time). This release adds the **root-cause**
counterpart: `post-edit-remind.sh` drops mechanically-trivial sentinels at write
time, so the assistant never sees them in the first place.

**Added — hook-level sentinel triage (`scripts/hooks/post-edit-remind.sh`):**
- Before writing sentinels, the hook measures the edited file's cumulative diff
  vs HEAD and drops false positives for the two change classes that are
  *mechanically* safe to detect: comment-only edits (drops db/security/frontend/
  polyfill/migration; keeps code + doc — comment detection is language-aware, so
  a JS `;(function(){…})()` or a PHP `--$counter` is never mistaken for a
  comment), and small pure-style CSS tweaks (net ≤ 8; drops db/security/frontend;
  keeps code). Whitespace/reformatting is intentionally NOT triaged here — no git
  whitespace flag can tell inert reindentation from a meaningful string-literal
  whitespace change (e.g. `explode('  ')` → `explode(' ')`), so that judgment
  stays with the execution-policy orchestration triage. Anything ambiguous (new
  file, binary, untracked, any git uncertainty) KEEPS every sentinel — a missed
  review is worse than an extra one. The diff is cumulative, so a file that grows
  substantial across edits re-acquires its sentinel.

**Fixed — harness-revise scripts:**
- `skills/harness-revise/scripts/test-harness.sh`: T9.1 emitted zero assertions
  silently when the main rule file (e.g. a repo with no top-level CLAUDE.md) was
  absent or had no `rules/*.md` refs; it now emits an explicit SKIP.
- `skills/harness-revise/scripts/harness-inventory.sh`: the dangling-skill scan
  covered only `rules/`; it now also scans the main rule file (CLAUDE.md /
  GEMINI.md), so a skill deleted from `skills/` while still referenced there is
  detected.

Consumers: run `claude plugin update` to pick up the new tag.

## 0.12.2 — 2026-06-25 — parallel reviewer dispatch + work-state handoff across compaction

Two harness improvements: reviewers run concurrently instead of in a serial
chain, and the PreCompact/PostCompact hooks now carry a full work handoff so a
conversation survives Claude Code's native auto-compaction without losing its
thread.

**Changed — reviewer dispatch (was a serial chain):**
- `rules/execution-policy.md`: the `database → security → … → doc` **serial
  chain** is replaced by **triage → parallel dispatch → merge**. After a turn's
  edits, triage drops false-positive sentinels (a 2-line CSS tweak or a typo-fix
  no longer pulls a full reviewer), the survivors dispatch **in parallel** (one
  message, multiple Agent calls — wall-clock `max`, not sum), and `code-reviewer`
  is the merge/dedup owner. Per-turn batching, CRITICAL-under-parallel handling,
  and an opt-in opus escalation note for HIGH-risk security/migration diffs.
- Stale "chain rule" / serial-order wording updated across `agents/INDEX.md`,
  `rules/anti-rationalization.md`, `skills/execution-checklist`,
  `skills/dhpk-execution-policy`, `agents/doc-reviewer.md`, `README.md`.

**Fixed — clear-sentinel path inconsistency:**
- `code-reviewer`, `database-reviewer`, `security-reviewer` called the
  project-local `clear-sentinel.sh`; the other three used the plugin path. All
  six now call `${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh`, so a
  project can drop its local copy.

**Added — work-state handoff across compaction:**
- `scripts/hooks/precompact-archive.sh` now also writes
  `.claude/artifacts/checkpoints/handoff-latest.md` — branch, pending review
  sentinels, the active OpenSpec change + done/open task counts, working tree,
  and recent commits (pure shell + git, best-effort, never blocks compaction).
- `scripts/hooks/postcompact-restore.sh` surfaces that handoff on stdout so it
  folds into post-compact context; `session-start.sh` surfaces it (recency-gated
  ≤12h) for the manual `/new` resume path.

Consumers: run `claude plugin update` to pick up the new tag.

## 0.12.1 — 2026-06-25 — harness-revise ships from the plugin (fixes unusable /harness-revise for general users)

Patch release. The `/harness-revise` command referenced a project-local,
gitignored path (`.agents/skills/harness-revise/`) for its skill include and its
three deterministic scripts, so general users who installed dhpk hit
file-not-found and the skill was effectively unusable via the command. Only
`harness-inventory.sh` had ever been committed to the plugin; the scenario and
test-harness scripts existed solely in a downstream project's customized fork.

**Fixed — the command now uses the plugin-bundled skill:**
- `@skills/harness-revise/SKILL.md` (matches every sibling command).
- Engine block runs `${CLAUDE_PLUGIN_ROOT}/skills/harness-revise/scripts/...`.
- `SKILL.md` resolves `SKILL_DIR` as `CLAUDE_SKILL_DIR` → `CLAUDE_PLUGIN_ROOT` →
  `.agents/` (cross-LLM fallback), with a warning when it falls through.

**Added — the two missing scripts, generalized for any dhpk project:**
- `harness-scenarios.sh` and `test-harness.sh` now ship inside the plugin.
- Hooks are discovered via `find -L $HARNESS_DIR/hooks/*.sh` instead of a
  hardcoded (project-specific / plugin-owned) list; symlinked harness dirs are
  followed.
- Project-behavior checks (php-cs-fixer guard, session-start markers,
  clear-sentinel lifecycle, settings.json schema, dhpk-versions, agents/INDEX.md)
  are gated behind detection: SKIP when not applicable, assert in full when
  present. `T9.2` additionally requires a dhpk-adoption signal so a non-dhpk
  project shipping its own `agents/INDEX.md` does not false-fail.
- jq `// []` / `:-0` guards against absent keys; the project-local hook-count
  floor is softened to an informational NOTE.

Consumers: run `claude plugin update` to pick up the new tag.

## 0.12.0 — 2026-06-21 — git flow release process + automated develop back-merge

Codifies the **git flow** branching model and closes the gap that let `develop`
drift 76 commits behind `main`: the post-release back-merge was manual and got
skipped. It is now automated and documented.

**New — `sync-develop` CI job (`.github/workflows/release.yml`):**
- Runs after the existing `release` job on every `v*` tag push.
- Checks out `develop`, fetches `main`, and back-merges with `--no-ff`
  (git-flow merge commit), then pushes `develop`.
- Fails **loudly** on a merge conflict — never silently drops the back-merge.
  "Already up to date" is a safe no-op, so re-runs are harmless.

**New — `RELEASE.md`:**
- Documents the full git-flow release flow: branch from `develop` → PR into
  `main` → tag → CI Release + auto back-merge → `develop`.
- States the permanent-branch rule (`develop` is never deleted) and the manual
  fallback if the CI back-merge is blocked (conflict / branch protection).

No runtime/module behavior changes — this release only touches the release
tooling and process docs.

## 0.11.0 — 2026-06-21 — Python module family (python / fastapi / pytest)

Adds first-class Python support — the last major stack gap. A consuming
full-stack project (ccas: FastAPI + SQLAlchemy-async + React/Vite) previously
had to hand-roll its own `.claude/hooks/*.sh` because dhpk shipped no Python
module. Backward compatible: the new modules are opt-in; projects that don't
enable them see zero change.

**New — `python` module (language baseline + tooling hooks):**
- `module.yaml` triggers code-reviewer on `.py`; provides skills `python-pro`
  (modern 3.10+ idioms, async-await discipline, logging-over-print, exception
  hierarchy) and `python-static-checks` (ruff rule selection, pyright-vs-mypy,
  progressive typing).
- `post-edit-python-lint.sh` (PostToolUse, async): advisory `ruff check` +
  `ruff format --check`, batched once at Stop via `stop-py-batch-check.sh`
  (`DHPK_PY_LINT_MODE=per-edit` for immediate; `DHPK_PY_STOP_TYPECHECK=1` adds a
  Stop-time type-check). Never blocks.
- `pre-commit-python-validation.sh` (PreToolUse Bash): the real gate — `ruff
  check` + `ruff format --check` + type-check (pyright|mypy) on staged `.py`,
  grouped by owning `pyproject.toml`. Exit 2 blocks; `[skip-python-lint]`
  bypasses. Mirrors the `php-7.4` pre-commit pattern (resolve-bin ladder,
  self-skip when toolchain absent — never blocks a project without the tools).
- **Zero-config monorepo support:** the owning project root is found by walking
  up to the nearest `pyproject.toml`, so a backend under `backend/` just works.
  `python_project_roots` optionally *restricts* linting to named subtrees.

**New — `fastapi` module (skills+refs, `requires: python`):**
- `fastapi-pro` skill: router/DI patterns, Pydantic request/response schemas,
  SQLAlchemy 2.0 async session & transaction discipline, Alembic migration
  safety, CORS/auth/error handling. Adds `db` / `sec` path triggers so
  database-reviewer / security-reviewer fire on model / migration / auth edits.

**New — `pytest` module (skills+refs, `requires: python`):**
- `pytest-async` skill: pytest-asyncio (`asyncio_mode=auto`), in-memory SQLite
  fixtures, `httpx.AsyncClient` + `ASGITransport`, unit/integration taxonomy,
  coverage floor, opt-in live markers. Test conventions for `tdd-guide`.

**New userConfig knobs (all optional, sane defaults):**
- `python_project_roots` (default `[]` = walk-up), `python_runner`
  (`uv run`; set `poetry run` or `` for bare PATH), `ruff_bin` (`ruff`),
  `python_typechecker` (`pyright`|`mypy`|`none`, default `pyright`),
  `pyright_bin`, `mypy_bin`.

**New install profiles:** `python-api` (`python,fastapi,pytest`) and
`python-fullstack` (`+ js`). `full` profile extended to include the family.

**Note — stale-cache bash errors (0.9.1):** the `declare -A` / arithmetic-trap
errors some sessions reported originate from the cached 0.9.1 plugin, not from
current source — `session-start.sh` has been bash-3.2-clean since 0.10.0
(`a9490b2`). Resolution: repin/reinstall dhpk to ≥0.10.0 in consuming projects
(`scripts/verify-claude-plugins.sh --update`). No code change in this release.

## 0.10.0 — 2026-06-12 — 7-slot sentinel chain, generic ops hooks, cross-platform fixes

Upstreams generic harness improvements matured in a consuming project
(zdpos-217). Backward compatible: all new userConfig keys default off/empty,
so existing consumers see zero behaviour change unless they opt in.

**New — migration-review is an official sentinel slot (slot 6):**
- `payload.sh` arrays extended to 7 slots (`.pending-migration-review` →
  `migration-reviewer`, agent already shipped). All array-driven consumers
  (clear-sentinel, reap, push-block, stop reminder, subagent verify) pick it
  up automatically; shorter `review_agents` overrides are padded with defaults.
- No built-in trigger: opt in via a module.yaml `migration:` triggers block
  (yii-1.1 now ships one for `protected/migrations/`) or
  `review_trigger_extra_paths` `mig:<prefix>`.
- New `SENTINEL_SHORT_NAMES` aligned array for statusline-style consumers.
- Removes the last reason consuming projects had to fork `payload.sh`.

**New hooks / scripts (opt-in or self-skipping):**
- `post-edit-manifest-guard.sh` (PostToolUse, async): lock-file sync reminder
  when a root manifest (composer.json / package.json / Gemfile / Cargo.toml /
  pyproject.toml) is edited. Per-project command via `lockfile_sync_commands`.
- `stop-completion-evidence.sh` (Stop, advisory): warns on completion claims
  with code changes but no test changes. Opt-in `completion_evidence_enabled`
  (env `DHPK_COMPLETION_EVIDENCE=1/0`).
- `pre-agent-warmstart.sh` (PreToolUse Task|Agent): injects sentinel state,
  active OpenSpec change, and the project's `.claude/warmstart-context.md`
  into subagent prompts (≤2000 chars). Opt-in `agent_warmstart_enabled`
  (env `DHPK_AGENT_WARMSTART=1/0`).
- `modules/php-5.6/hooks/post-edit-php-syntax.sh`: async `php -l` parse check
  on PHP edits; binary/wrapper via new `php_bin` (e.g. docker exec wrapper).
- `check-plugin-version.sh` (SessionStart advisory): flags the running plugin
  version against the project's `.claude/dhpk-versions.json` pin file
  (template: `templates/dhpk-versions.json`). Silent without a pin file.
- `scripts/check-cross-cli-drift.sh` (SessionStart advisory): warns when
  `.claude/` is newer than `.codex/` / `.gemini/` mirrors (threshold env
  `DHPK_CROSS_CLI_DRIFT_THRESHOLD`, default 1h). Silent without mirrors.
- SessionStart also warns on broken symlinks directly under `.claude/`
  (restore command line via new `harness_restore_hint`).
- `templates/settings.local.json.example` for project onboarding.

**Improvements:**
- camelCase `filePath` payload fallback in `post-edit-remind.sh` and
  `post-write-crlf-fix.sh` (Write-tool payload variants no longer drop
  sentinels / CRLF fixes).
- `payload.sh` runtime drift guard: warns and truncates (fail-soft) when the
  sentinel arrays fall out of alignment.
- `pre-bash-dispatch.sh` only forks module `pre-commit-*` hooks for actual
  `git commit` commands (perf; behaviour unchanged — hooks already self-skip).
- `DHPK_HOOK_PROFILE` env var as one-shot hook-profile override.
- js module tier detection is now project-configurable: new userConfig keys
  `js_frontend_roots` / `js_core_files` / `js_vendor_globs` override the
  module.yaml `js:` block, so projects curate their core/vendor lists without
  editing the shared plugin.
- 10s `timeout` guard on the graduation-scan python pass (where coreutils
  timeout exists).
- Advisory stderr prefixes normalised to ASCII `[WARN]` (was `⚠`).

**Fixes:**
- `session-start.sh` used `declare -A` (bash 4+) — broke stock macOS bash 3.2.
  Replaced with a portable membership check.
- `session-start.sh` module banner truncated multi-word display names
  ("Yii 1.1 Framework" → "Yii") and corrupted the `requires:` validation for
  any module whose display name contains a space (spurious "requires X but it
  is not enabled" warnings). The python↔bash handoff is now tab-separated.
- More bash-4/GNU-only idioms removed: `${var,,}` in
  `scripts/lib/install-prompts.sh`, `date -d` without a BSD fallback in
  `scripts/opsx-apply-resume/detect-phase.sh`. New CI gate
  `scripts/check-portability.sh` (bash -n + idiom grep over every shipped
  script) keeps these out.
- Security: invalid `GUARD_EXTRA_PATTERNS` regex now fails closed (blocks the
  edit with exit 2) instead of silently disabling the project guard. If your
  pattern was broken, fix it or unset it — previously it guarded nothing.

## 0.9.1 — 2026-06-04 — Parallel-session-safe MCP reap + prompt-caching guidance

Bugfix + hardening release. No breaking changes; opt-in reaper behaviour only.

**Fix — `reap_stale_mcp_processes` is now parallel-session safe:**
- The SessionStart reaper used "kill all but the newest" `gitnexus mcp` process.
  When more than one Claude session runs concurrently in the same repo, that
  killed gitnexus servers owned by **live sibling sessions** — surfacing as a
  spurious "1 failed MCP server" on the other session's next tool call (and, on
  prefix-loaded tool setups, a prompt-cache bust). It now reaps **only orphans**
  (parent process gone / reparented to init), never a process with a live parent.
- Liveness is probed with `ps -p` (ownership-agnostic) instead of `kill -0`,
  which returns EPERM for a live cross-user parent (`sudo` / container root) and
  would mis-reap it. The block is additionally guarded on `command -v ps`.
- Benign known limitation: on systemd-user hosts an orphan reparented to
  `systemd --user` (ppid≠1, still alive) is not detected — it simply lingers.

**Docs:**
- `context-budget` skill gains a **Prompt Caching** section: the three-layer
  prefix model, do/don't behaviours (pin model+effort, avoid `opusplan`, no
  mid-task fast-mode toggle, `/compact` at task boundaries), a "does NOT affect
  the cache" list (statusline / sentinel files / async hooks / SessionStart
  dynamic output), TTL notes, and how to verify via `cache_read` vs
  `cache_creation`.
- `reap_stale_mcp_processes` description (plugin.json + README EN/zh-TW) updated
  to reflect orphan-only behaviour.

## 0.9.0 — 2026-06-02 — De-couple from origin project + harness hardening (hooks, agents)

Genericization + hook/agent hardening release, benchmarked against the ecc /
everything-claude-code marketplaces. Additive by default — the only behaviour
change is the js module's lint timing (now batched at Stop; opt back to per-edit
with `DHPK_JS_LINT_MODE=per-edit`).

**De-coupling (plugin must be project-agnostic):**
- **New `hot_tables` userConfig key** — projects declare their high-volume tables
  for `performance-analyzer` / `migration-reviewer` instead of relying on
  hard-coded example names. Defaults `[]` (fall back to generic heuristics +
  CLAUDE.md).
- Removed single-project / identity leaks from generic content: migration-reviewer
  example author/site (`217_Neil` → `<site_id>` / `<author>` placeholders);
  performance-analyzer hard-coded POS table names → labelled examples + `hot_tables`
  pointer; INDEX.md migration-slot example de-named; deploy-list dropped the phantom
  `php-yii-zdpos` preset (the script only ships `php-yii`); renamed
  `phpunit57-zdpos.md` → `phpunit57-php56-legacy.md` (php-5.6 + codex skill copies,
  references updated). Design-doc history and CHANGELOG references retained as
  historical context.

**Reviewer quality guardrails (benchmarked vs everything-claude-code):**
- `code-reviewer` — added a **Confidence gate (emit stage)** (4-question pre-report
  filter, HIGH/CRITICAL proof requirement, "zero findings is valid") and a
  **Common false positives** skip-list. Complements (does not replace) the existing
  "Do NOT skip when…" anti-rationalization rule — that governs *running* the review,
  these govern *not emitting low-confidence noise*.
- `refactor-cleaner` — workflow now has a `rg` fallback when gitnexus/cx is absent
  (portability) and explicit small-batch verify-then-commit discipline.

**New guard hooks (ecc-benchmarked):**
- `pre-edit-guard` — **config-protection**: blocks edits that *weaken an existing*
  linter / formatter / static-analysis config (eslint/prettier/biome/php-cs-fixer/
  phpcs/phpstan/psalm/ruff/flake8/pylint/mypy) to make a failing gate pass. First-time
  creation is allowed; multi-purpose files (tsconfig.json, package.json) are
  intentionally excluded. Opt out: `DHPK_PROTECT_LINT_CONFIGS=0`.
- `pre-bash-guard` — blocks `git commit/push --no-verify` (bypasses the
  pre-commit/pre-push gates). Short `-n` is left alone (overloaded: push `-n`
  = --dry-run). Opt out: `DHPK_ALLOW_NO_VERIFY=1`.

**js module — batched lint at Stop:**
- post-edit-js-lint now *accumulates* edited frontend paths and runs ESLint **once at
  Stop** (new `stop-js-batch-check.sh`) instead of once per edit. New generic
  `stop-dispatch.sh` fires module `stop-*.sh` hooks (mirrors post-edit-dispatch).
  `DHPK_JS_LINT_MODE=per-edit` restores the legacy immediate behaviour;
  `DHPK_JS_STOP_TYPECHECK=1` adds a whole-project typecheck at Stop.

**New agent + planning/loop discipline:**
- **`silent-failure-hunter`** (situational, read-only, 19th agent) — deep
  error-handling audit (empty catch / swallowed exceptions / error-hiding fallbacks /
  lost stack traces / missing rollback). Wired as a `code-reviewer` delegate; not a
  sentinel.
- `architect` — added a **Phased Plan** section (independently-deliverable phases +
  per-step Action/Why/Deps/Risk + risks & success criteria), distilled from ecc's
  planner without adding a redundant agent.
- `rules/execution-policy.md` Anti-loop — broadened stop/escalation conditions
  (no-progress-across-2-checkpoints, identical repeated failure, cost/context drift,
  recurring blocking conflict) + a pre-loop safety-floor checklist (gate active /
  baseline / rollback / isolation), distilled from ecc's loop-operator.

**Distilled rules (`/rules-distill` over dhpk's own 62 skills):** cross-cutting
principles that recurred across ≥2 skills, promoted into the three opt-in rule files:
- `rules/execution-policy.md` — three new sections: *Classification-first context
  loading* (classify workflow type before loading heavy references), *Multi-AI /
  dual-perspective independence* (each AI forms its own conclusion; never feed Claude's
  analysis into the secondary prompt), *Deterministic first, judgment second*
  (collect via scripts → gate → judge; tool output is immutable). Plus a *Review output
  gate* (✅/⚠️/⛔ + status word + one-line justification) and a Codex-only *Review-loop
  ceiling* (3 rounds/sentinel) distinct from the general anti-loop stop.
- `rules/tool-routing.md` — new *Investigation order & perspective depth* section
  (path-first tracing, single→dual escalation by uncertainty, parallel exploration
  capped at ≤3 non-overlapping agents).
- `rules/anti-rationalization.md` — added a Not-Invented-Here counter-row
  (library evaluation is the prerequisite, not the conclusion).

## 0.8.1 — 2026-06-01 — Stop-review-reminder honors `stop_hook_active`

Bugfix release. The `stop-review-reminder` Stop hook never read its stdin
payload, so it ignored Claude Code's `stop_hook_active` flag and re-blocked
on every consecutive Stop attempt while a review sentinel existed — ending
only when the harness block cap force-overrode it (the alarming "blocked N
consecutive times" message). It now reminds once, then yields. No behaviour
change for projects on `hook_profile=minimal` (still fully silent). Existing
sentinel-clearing flows (run the reviewer / `clear-sentinel.sh`) are unchanged.

### Fixed

- **`scripts/hooks/stop-review-reminder.sh`** — reads the Stop hook stdin
  payload and exits 0 (yields) when `stop_hook_active=true`, after the
  `hook_profile=minimal` early-exit. First Stop still emits the `exit 2`
  reminder once; the forced re-entry no longer re-blocks. Empty stdin / missing
  `jq`+`python3` degrade safely to the prior single-block behaviour.

### Added

- **`scripts/hooks/_lib/payload.sh`** — `extract_top_field <field> <payload>`
  helper for top-level JSON fields (jq with python3 fallback), mirroring
  `extract_tool_input`'s error-swallowing contract. Documents the
  boolean-false-collapses-to-empty caveat.
- **`scripts/validate/test-hooks.sh`** — section 11 smoke tests for the
  remind-once-then-yield behaviour (55 checks total, all green).

## 0.8.0 — 2026-06-01 — Laravel 5.4 + Vue 2 + Laravel Mix modules

Feature release. Adds three opt-in stack modules covering the legacy
Laravel-5.4 / Vue-2 / Laravel-Mix-5 era (PHP 5.6 floor), bringing the shipped
module count to 24. All opt-in via `userConfig.modules`; existing projects see
zero behaviour change. `laravel-5.4` joins the additive `laravel` stack;
`vue-2` and `laravel-mix` are new single-version frontend stacks.

### Added

- **`modules/laravel-5.4/`** — Laravel 5.4 (LTS, Feb 2017; PHP 5.6.4 floor).
  Blade components & slots (introduced here), implicit/explicit route model
  binding, web/api middleware groups, realtime facades, markdown mailables,
  `Collection` higher-order messages, Laravel Dusk, resource routes; the
  Elixir → Mix frontend transition and the 5.3 → 5.4 breaking-change traps;
  what's missing vs 5.5+ (package auto-discovery, `apiResource`). Joins the
  `laravel` stack with `requires_module: php-5.6`.
- **`modules/vue-2/`** — Vue 2 (`^2.5`, Options API only — predates the
  Composition API). The `data()` / `computed` / `methods` / `watch` + lifecycle
  shape, props-down + `$emit` events-up, vue-loader SFC compilation, the Vue 2
  reactivity caveats (`Vue.set` / `$set` for new object keys and array
  index/length), and `@vue/test-utils` 1.x + `vue-jest` 3 SFC testing. New
  exclusive `vue` stack.
- **`modules/laravel-mix/`** — Laravel Mix 5 (`^5.0.9`, webpack 4 wrapper).
  `webpack.mix.js` entry/output mapping, `mix()` versioning + manifest, the
  `dev` / `watch` / `watch-poll` / `hot` / `prod` npm-script ladder, the Elixir
  heritage, and the legacy-OpenSSL prod-build flag on newer Node; Mix 5 → 6
  upgrade notes. New exclusive `laravel-mix` stack.

### Changed

- `manifests/module-catalog.json` — `laravel-5.4` prepended to the `laravel`
  stack versions; new `vue` and `laravel-mix` stacks appended.
- `.claude-plugin/plugin.json` — three skills paths registered; `version` →
  0.8.0; description, keywords, and `userConfig.modules` "Ships" list updated.
- `README.md` / `README.zh-TW.md` — module count 21 → 24; new Frontend grouping
  (`js`, `vue-2`, `laravel-mix`); Laravel row includes `laravel-5.4`.

## 0.7.0 — 2026-05-31 — iOS / Swift module suite

Feature release. Adds a five-module iOS/Swift stack, a Swift build-resolver
agent, and Swift-gated reviewer coverage. All opt-in via `userConfig.modules`;
PHP/JS projects see zero behaviour change. The suite is dependency-chained —
`swiftui` / `ios-platform` / `swift-testing` / `xcode-tooling` each
`requires: swift`.

### Added

- **`modules/swift/`** (Swift 6) — strict-concurrency baseline (Sendable /
  actors, async-await), Swift 5.10 / iOS 17 compatibility notes, and Swift 6.2+
  (Xcode 26+) approachable-concurrency defaults (async stays on the caller,
  `@concurrent` opt-in offload, isolated conformances, MainActor default
  inference). Optionals discipline, value-vs-reference, error handling. The
  foundation the rest of the suite requires.
- **`modules/swiftui/`** — MVVM + Coordinator, Observation framework
  (`@Observable` / `@Bindable`), `NavigationStack` + type-safe routing,
  state-ownership rules, Combine + UIKit interop.
- **`modules/ios-platform/`** — iOS SDK for a health/PHI app: Core Data at-rest
  encryption (SQLCipher / File Protection), CryptoKit + Keychain, an actor-based
  offline local store, Vision OCR (handwriting limits + manual fallback),
  AVFoundation, LocalAuthentication, UserNotifications, HealthKit read-only,
  privacy-manifest / no-iCloud compliance.
- **`modules/swift-testing/`** — XCTest + Swift Testing
  (`@Test` / `#expect` / `#require` / parameterized), XCUITest,
  swift-snapshot-testing, a 3-layer unit/integration/UI taxonomy, and
  protocol-based DI for host-testable (`swift test`) file/Keychain/network code.
- **`modules/xcode-tooling/`** — post-edit SwiftLint hook (async, self-skip) +
  pre-commit xcodebuild/SPM build+test gate (build uses a device-name-free
  generic destination; tests auto-fall back to an available simulator; both
  self-skip when the toolchain is absent), scheme/signing notes, and an
  `ios-icon-gen` skill (SF Symbols / Iconify → asset-catalog imageset).
- **`agents/swift-build-resolver.md`** — surgical Swift / Xcode / SPM
  build-error resolver: error→cause→fix table, generic-destination retry,
  3-attempt stop conditions, hand-off to `code-reviewer`. (17th root agent.)
- **Swift-gated reviewer coverage** — `code-reviewer` (force-unwrap / Sendable /
  concurrency / retain-cycle traps), `security-reviewer` (iOS Keychain /
  at-rest-encryption / PHI-privacy fix map), `database-reviewer` +
  `migration-reviewer` (Core Data threading / encryption / model migration),
  `tdd-guide` (iOS test layout + run commands).
- **`ios-app` install profile** + four userConfig knobs (`swiftlint_bin`,
  `xcode_scheme`, `xcode_destination`, `swift_build_skip_tests`).

### Changed

- `xcode_destination` defaults to empty: the pre-commit test step then
  auto-picks the first available iOS simulator and the build step always uses a
  device-name-free generic destination, so a stale named-simulator default
  (e.g. the `iPhone 16` that Xcode 26 no longer ships) can never break the gate.

## 0.6.2 — 2026-05-29 — Fix: pre-edit-guard .env template false positive

Bugfix release.

- **`pre-edit-guard` no longer blocks version-controlled `.env` templates.**
  The sensitive-path regex `(\.env(\..*)?$|\.git/)` matched `.env.example`,
  `.env.sample`, `.env.dist`, and `.env.template` — committed, secret-free
  templates that projects legitimately edit. These suffixes are now carved
  out via an explicit allow-list (POSIX ERE has no negative lookahead, so the
  exception is a separate match rather than baked into the block regex).
  Real secret files (`.env`, `.env.local`, `.env.production`, …), `.git/`
  internals, and lock files remain blocked.

## 0.6.0 — 2026-05-28 — Phase 2: learning DB + knowledge graduation + Smart Router + codex opt-in

Feature release. Lands all of Phase 2 from the vexjoy-agent comparison
plan, all opt-in and (for the hooks) default OFF — existing projects see
zero behaviour change until they turn a knob on:

1. **Learning DB (2.1)** — a dependency-light append-only store of
   operational signals (reviewer pass, subagent failure, abnormal stop),
   surfaced at SessionStart as a `[learned-context]` block.
2. **Knowledge graduation (2.2)** — ported and generalised from
   zdpos_dev's mature local hook (which turned out to be the real
   reference the plan's "dhpk 通用化 graduation-candidates.md" intent
   pointed at). Scans the transcript for cited auto-memory entries and
   proposes stable ones for promotion to a rule/skill.
3. **Smart Router `/dhpk:do` (2.3)** — one natural-language entry point
   that resolves a free-text request to the right workflow via a
   deterministic route-table fast path, falling back to LLM
   classification on a miss. Adds an entry point; never replaces the
   underlying commands.
4. **Codex made opt-in + `adaptive-dev-workflow` ported (2.4)** — dev
   workflows now run **codex-free by default**; `--codex` opts in. The
   isolation invariant: a default-free skill carries no `mcp__codex__*`
   in `allowed-tools`, so it cannot reach Codex unless it delegates to a
   dedicated `codex-*` command. zdpos_dev's `adaptive-dev-workflow`
   classifier was upstreamed, de-identified into a framework-agnostic
   skill (project override via `@rules/dev-workflow-project.md`), and
   `/dhpk:do` now routes substantial bug/feature tasks through it.

### Added

- **`skills/adaptive-dev-workflow/`** — generic pre-implementation
  classifier (Feature Delivery / Bug Investigation / Lightweight
  Maintenance) with planning-agent dispatch + gate checklist, ported and
  de-identified from zdpos_dev. Project-specific prefills/shortcuts load
  from the consuming project's `@rules/dev-workflow-project.md`. Codex-aware
  (default codex-free; `--codex` delegates to `codex-*` commands).
- **`commands/create-dev.md`** (`/dhpk:create-dev`) — explicit entry point
  to `adaptive-dev-workflow`. Resolves the v0.4.0 "Deferred" item.
- **`scripts/hooks/_lib/learning-db.sh`** — sourced library for the
  operational-signal store. Append-only `.claude/artifacts/learning.jsonl`
  (`{ts, epoch, kind, sig, detail, weight}` per line). Confidence is
  derived at read time per signature:
  `clamp(0,1, 0.5 + Σweight − 0.05·floor(days_idle/30))` — success
  events default +0.05, failure −0.1, with recency decay so stale
  signatures sink. Functions: `ldb_enabled`, `ldb_record`,
  `ldb_aggregate` (TSV: conf%/obs/days/kind/sig), `ldb_top`,
  `ldb_graduation_candidates` (default ≥90% conf AND ≥10 obs).
  jq-first with a python3 write fallback; degrades to a silent no-op
  when neither is present. Self-rotates past `DHPK_LEARNING_CAP_BYTES`
  (default 50MB) into `learning-archive/`.
- **`scripts/hooks/stop-graduation-scan.sh`** — Stop hook (advisory,
  python3). Scans the session transcript for cited auto-memory entries
  (`~/.claude/projects/<slug>/memory/<entry>.md`), maintains cross-session
  counts + confidence in `.claude/artifacts/memory-usage-counts.json`
  (Phase A count ≥3; Phase B confidence start 0.5, +0.1 clean / −0.2 trap
  re-occurrence), and regenerates `.claude/artifacts/graduation-candidates.md`.
  A time-span gate (≥24h, ≥3 distinct dates) blocks same-day false
  positives; missing source files decay then tombstone (orphan handling).
  In OpsX projects, high-confidence entries auto-draft a change skeleton
  (guarded — skipped in non-OpsX projects). Generalised from zdpos: adds a
  `CLAUDE_HOOK_MEMORY_DIR` test override and bootstraps the report from the
  shipped template on first run.
- **`templates/graduation-candidates.md`** — report template the
  graduation hook copies into a consumer's `.claude/artifacts/` on first
  enabled run (a plugin can't assume the user pre-scaffolded it).
- **`scripts/lib/pre-route.sh`** — canonical deterministic matcher: maps
  a free-text request to a `route-table.json` workflow, printing
  `MATCH<TAB>skill<TAB>label` / `NO_MATCH` / `NO_QUERY`. Reads the query
  from args or stdin; `DHPK_ROUTE_TABLE` override for tests; degrades to
  `NO_MATCH` without python3 / table. Always exits 0.
- **`commands/do.md`** — `/dhpk:do <task>` Smart Router. Runs pre-route
  first; on `MATCH` invokes the routed skill directly (no re-classify),
  on `NO_MATCH` classifies and picks the best-fit command, on `NO_QUERY`
  asks. Optional ENHANCE step folds in any `[learned-context]` block.
- **`.claude-plugin/plugin.json`** — new `learning_db_enabled` and
  `graduation_scan_enabled` userConfig (both boolean, default false).

### Changed

- **`/dhpk:do` is codex-free by default**, `--codex` opt-in. `do`'s
  bug/feature route-table rules now target `dhpk:adaptive-dev-workflow`;
  security defaults to `dhpk:security-review` (codex-free), `--codex` →
  `dhpk:codex-security`.
- **`skills/{bug-fix,feature-dev,security-review}`** gained the codex-free
  default + isolation guard; `mcp__codex__*` removed from their
  `allowed-tools`. `security-review` is now codex-free only (the Codex audit
  lives in the `/codex-security` command, which no longer `@`-includes the
  skill).
- **`scripts/hooks/clear-sentinel.sh`** — records a `success`
  (`review:<sentinel>`) event each time a reviewer clears its sentinel.
  Now sources `load-project-config.sh` so enablement honours project
  settings even when invoked as a plain Bash command.
- **`scripts/hooks/subagent-stop-verify.sh`** — records `failure`
  (`agent:<name>` on non-zero exit, `sentinel-uncleared:<name>` on a
  success-but-uncleared sentinel) alongside the existing log line.
- **`scripts/hooks/stop-failure-log.sh`** — records a `failure`
  (`abnormal-stop`) event when a session stops with pending sentinels.
- **`scripts/hooks/session-start.sh`** — when the learning DB is enabled,
  prints a `[learned-context]` block with the top 5 signatures (≥2 obs),
  capped well under 500 tokens.
- **`scripts/hooks/userpromptsubmit-skill-hint.sh`** — refactored to
  delegate matching to the new `pre-route.sh` instead of its own embedded
  regex loop, so the route table has a single matcher. Gating
  (profile / slash-prefix / length / opt-out) and stderr formatting
  unchanged; behaviour identical (section 1 tests still green).
- **`hooks/hooks.json`** — registers `stop-graduation-scan.sh` in the Stop
  chain (after `stop-review-reminder`, before the async sentinel reaper).
- **`scripts/validate/validate-harness.sh`** — section 7 whitelist emptied
  now that `commands/do.md` exists (all 21 route-table targets resolve).

### Verified

- `scripts/validate/test-hooks.sh` extended to 49 checks: section 8
  covers the learning DB (lib, all three producers, default-off gate,
  SessionStart on/off); section 9 covers graduation (count accrual +
  confidence rise → rule candidate + template bootstrap, the existence
  gate, and the default-off gate, all via `CLAUDE_HOOK_TEST_MODE` +
  `CLAUDE_HOOK_MEMORY_DIR` isolation); section 10 covers pre-route
  (EN/CJK matches, the codex-security typo-fix, NO_MATCH, NO_QUERY,
  stdin path). `bash -n` clean on every changed script;
  `validate-harness.sh` and both JSON manifests parse green.


## 0.5.0 — 2026-05-28 — Lifecycle hook coverage + anti-rationalization gates + skill-hint router seed

Feature release. Closes three lifecycle gaps identified in the
vexjoy-agent comparison audit
(`~/.claude/plans/dhpk-plugin-1-functional-swan.md`): (1) the only
lifecycle events dhpk wired pre-0.5 were `PreToolUse / PostToolUse /
SessionStart / Stop` — `PreCompact / PostCompact / SubagentStop /
StopFailure / UserPromptSubmit` were all unwired, so session compaction
silently dropped sentinel state, subagent failures left no log trail,
and incoming user prompts never got workflow hints; (2) the
anti-rationalization rule file (added in 0.4.0) was advisory-only —
nothing hooked into bash to enforce "don't bypass the reviewer chain"
or "don't commit to main by accident"; (3) the 70 commands form a flat
catalog with no discovery surface for users who type natural language.
This release adds five new hook entrypoints, two new gate hooks, and a
seed route-table that the planned `/dhpk:do` Smart Router (Phase 2)
will reuse. Everything is opt-in via `userConfig`; default profile
behavior on existing projects is unchanged except for the
UserPromptSubmit hint (which prints a one-line stderr suggestion).

### Added

- **`scripts/hooks/subagent-stop-verify.sh`** — SubagentStop hook
  (advisory). When a reviewer subagent finishes, cross-checks the
  corresponding sentinel: warns when the sentinel is uncleared
  (likely missed `clear-sentinel.sh` call) and logs non-zero exit
  status to `.claude/artifacts/agent-failures.log`. Ported from
  zdpos_dev's local hook; de-identified (no `dhpk:` agent prefix
  assumption — looks up `SENTINEL_AGENTS` from `_lib/payload.sh`).
  Profile-aware (minimal suppresses stderr but still logs).
- **`scripts/hooks/stop-failure-log.sh`** — StopFailure hook
  (advisory). Records active sentinels and optional reason from
  the payload into `.claude/artifacts/stop-failures.log` so the
  next SessionStart (or a human) can see what was pending when the
  previous session abnormally terminated. Ported from zdpos_dev.
- **`scripts/hooks/precompact-archive.sh`** — PreCompact hook.
  Snapshots every active sentinel's content into
  `.claude/artifacts/checkpoints/precompact-<session_id>.json`
  before Claude Code compresses the conversation. Maintains a
  `latest.json` symlink for fast lookup. python3 path JSON-encodes
  sentinel bodies (preserves embedded newlines / quotes from
  `post-edit-remind`'s file lists); falls back to an empty-sentinels
  envelope when python3 is missing rather than failing.
- **`scripts/hooks/postcompact-restore.sh`** — PostCompact hook.
  After compaction, reads the latest checkpoint and restores any
  sentinel that is currently missing. Never overwrites an existing
  sentinel (post-compact user/assistant may have already updated
  it). Supports python3 (base64-aware) and jq fallback paths.
- **`scripts/hooks/userpromptsubmit-skill-hint.sh`** — UserPromptSubmit
  hook (advisory). Matches the incoming prompt against
  `scripts/lib/route-table.json` (21 patterns: 15 English, 6
  Traditional Chinese) and prints one stderr line suggesting the
  relevant dhpk command (e.g. "this prompt looks like a bug fix
  workflow task — consider running /dhpk:bug-fix"). First match
  wins. Skipped when:
  - profile is `minimal`
  - prompt starts with `/` (user already invoked an explicit command)
  - prompt is shorter than 8 chars (noise floor)
  - `DHPK_DISABLE_SKILL_HINT=1` env (one-shot)
  - `userConfig.skill_hint_enabled=false` (persistent)
- **`scripts/hooks/pretool-sentinel-gate.sh`** — PreToolUse Bash hook
  (default warn). Companion to `pre-bash-guard.sh`. While
  `pre-bash-guard` hard-blocks `git push` when sentinel-listed paths
  are still uncommitted, this hook warns (or optionally blocks) on
  `git commit / merge / rebase / cherry-pick` while reviewer
  sentinels exist. The asymmetry is intentional: commit is local
  and may legitimately precede review; push is team-visible and
  warrants the hard block. Mode controlled by
  `DHPK_SENTINEL_COMMIT_GATE` env (one-shot) or
  `userConfig.sentinel_commit_gate` (persistent): `warn` (default) |
  `block` | `off`.
- **`scripts/hooks/pretool-branch-safety.sh`** — PreToolUse Bash hook
  (default warn). Warns (or optionally blocks) on history-mutating
  git verbs (`commit / merge / rebase / cherry-pick / reset / push`)
  when the current branch matches the protected list. Branch list
  configurable via `userConfig.protected_branches` (default: `main`,
  `master`, `develop`, `release/*`, `hotfix/*`; glob syntax via bash
  case-match). Mode via `DHPK_BRANCH_SAFETY` or
  `userConfig.branch_safety`: `warn` (default) | `block` | `off`.
- **`scripts/lib/route-table.json`** — SSOT for prompt → workflow
  routing. Used today by `userpromptsubmit-skill-hint.sh` (advisory
  hint); reserved for Phase 2's `/dhpk:do` Smart Router (planned
  CLASSIFY → ROUTE → ENHANCE → EXECUTE → LEARN flow). 21 patterns
  covering bug-fix, feature-dev, code-review, security-review,
  code-explore, project-audit, deploy-list, simplify / refactor,
  tech-spec, smart-commit, create-pr, feasibility-study,
  risk-assess, precommit, verify — first match wins, ordered
  specific → general.

### Changed

- **`hooks/hooks.json`** — registers five new lifecycle event slots
  (`PreCompact`, `PostCompact`, `SubagentStop`, `StopFailure`,
  `UserPromptSubmit`) and adds two new PreToolUse Bash hook entries
  (`pretool-sentinel-gate.sh`, `pretool-branch-safety.sh`) alongside
  the existing `pre-bash-dispatch.sh`. Order matters: dispatch runs
  first so module-specific bash guards (e.g. JS pre-commit) gate
  before the soft sentinel/branch reminders.
- **`.claude-plugin/plugin.json`** — adds four new `userConfig`
  knobs (`sentinel_commit_gate`, `branch_safety`,
  `protected_branches`, `skill_hint_enabled`). All defaults chosen
  to be warn-only / opt-out for backward compatibility: existing
  projects gain stderr reminders but no new hard blocks. Version
  bumped 0.4.0 → 0.5.0.
- **`scripts/validate/test-hooks.sh`** — automated smoke-test
  harness for all seven new hooks. Each case runs the real hook
  against an isolated `mktemp -d` git repo (path-aligned via
  `git rev-parse` so symlinked `/tmp` cannot cause false
  negatives), asserting stderr/exit-code/artifact behaviour
  including the warn/block/off mode matrix and the no-overwrite
  restore path. 28 checks; exit 1 on any failure.
- **`scripts/validate/validate-harness.sh`** — new section 7
  "Route table SSOT": every `route-table.json` rule's
  `skill: dhpk:<name>` must map to an existing `commands/<name>.md`.
  Whitelists `do` (Phase 2 Smart Router, not yet built); skips
  gracefully in consumer projects where the route table is absent.

### Verified

- `bash -n` clean on all seven new shell scripts.
- `python3 -m json.tool` passes for `hooks/hooks.json`,
  `.claude-plugin/plugin.json`, and `scripts/lib/route-table.json`.
- All 21 `route-table.json` patterns compile under `re.IGNORECASE`,
  and all skill targets resolve to real commands (one stale
  `dhpk:security-review` → `dhpk:codex-security` typo fixed; now
  enforced by `validate-harness.sh` section 7).
- Hook end-to-end smoke tests now automated in
  `scripts/validate/test-hooks.sh` (28 checks, all green):
  - `precompact-archive` / `postcompact-restore`: round-trips a
    sentinel through a checkpoint; verifies the no-overwrite path
    leaves a live-edited sentinel untouched.
  - `subagent-stop-verify`: non-reviewer subagent → silent exit 0
    with no log growth; failed/uncleared reviewer → log entry.
  - `stop-failure-log`: writes `active_sentinels=` (and `none`
    when empty) + reason from payload.
  - `userpromptsubmit-skill-hint`: matches English + Traditional
    Chinese bug prompts; skips `/` prefix, short prompts, and the
    `DHPK_DISABLE_SKILL_HINT=1` opt-out.
  - `pretool-sentinel-gate`: silent when no sentinel / non-git;
    warns on `git commit` when sentinel present; exit 2 under
    `DHPK_SENTINEL_COMMIT_GATE=block`; silent under `off`.
  - `pretool-branch-safety`: warns on protected branch; silent on
    feature branch; exit 2 under `block`; silent under `off`.

### Non-changes

- Sentinel chain SSOT (`scripts/hooks/_lib/payload.sh`) unchanged.
- `post-edit-remind.sh`, `stop-review-reminder.sh`,
  `reap-stale-sentinels.sh`, and `clear-sentinel.sh` unchanged.
- No existing agent / skill / command body renamed or removed.
- Library-author module's `.pending-polyfill-review` slot
  unchanged; new gates honour it transparently via `SENTINEL_NAMES`.

### Deferred to Phase 2

- `/dhpk:do` Smart Router command + `pre-route.sh` fast-path are
  designed but not implemented this release. `route-table.json`
  ships now so Phase 2 can reuse it without a schema migration.
- Learning DB (`.claude/artifacts/learning.jsonl`) and
  cross-session graduation flow — `stop-failure-log.sh` already
  writes the failure log Phase 2 will consume.
- Confidence-weighted instinct auto-graduation.

### Upgrade notes

- Existing projects: on next session, three new stderr lines may
  appear depending on workflow:
  - "[skill-hint] this prompt looks like ..." for English /
    Traditional Chinese prompts matching the route table. Silence
    via `DHPK_DISABLE_SKILL_HINT=1` or set
    `userConfig.skill_hint_enabled=false` in
    `.claude/settings.local.json`.
  - "⚠ REMINDER: commit attempted while reviewer chain is
    pending..." when sentinels exist and `git commit` is called.
    Silence via `DHPK_SENTINEL_COMMIT_GATE=off` or
    `userConfig.sentinel_commit_gate="off"`.
  - "⚠ REMINDER: commit on protected branch 'main'..." when
    committing to a protected branch. Silence via
    `DHPK_BRANCH_SAFETY=off` or `userConfig.branch_safety="off"`,
    or narrow the list via `userConfig.protected_branches`.
- No existing behaviour changes for `pre-bash-guard.sh` (rm -rf,
  curl|sh, chmod 777, git push w/ active sentinels).
- The new `.claude/artifacts/{agent-failures,stop-failures}.log`
  and `.claude/artifacts/checkpoints/` paths are auto-created by
  the hooks; add to `.gitignore` if not already covered by the
  existing `.claude/artifacts/**` exclusion.

## 0.4.0 — 2026-05-27 — Absorb zdpos harness improvements + introduce rules/ resource layer

Feature release. Pulls in improvements from the zdpos_dev project after a
133-pair Phase A diff (15 agents + 65 commands + 53 skills) revealed:
(1) dhpk's existing role agents and codex commands already dominate the
overlap — most zdpos copies were stale forks of older dhpk releases plus
hardcoded project name / container path; (2) a small set of skills /
commands / agents exist only in zdpos that are framework-generic enough to
de-identify and ship upstream; (3) zdpos has been maintaining three
governance rules (execution-policy, tool-routing, anti-rationalization) as
plain markdown — dhpk did not have a `rules/` layer at all.

### Added

- **`agents/migration-reviewer.md`** — multi-tenant DB migration safety
  reviewer (up/down symmetry, idempotency, FK / index naming collision
  across multi-tenant deploy footprints, large-ALTER strategy on
  high-volume tables). Companion to (not replacement for)
  `database-reviewer`. Originally a zdpos-specific reviewer for Yii 1.1
  migrations; de-identified to drop the "22 merchant" wording and the
  hardcoded `pos_mysql` / `pos_php` container names. Registered in
  `plugin.json` `agents[]`. Triggered by a project that wires
  `.pending-migration-review` sentinel in its post-edit hook (zdpos
  ships this; other projects can adopt the same sentinel name).
- **`commands/de-ai-flavor.md`** — command shell that invokes the
  existing `de-ai-flavor` skill. Skill itself already shipped in
  v0.3.x; only the slash command was missing.
- **`commands/deploy-list.md`** — command shell for the existing
  `deploy-list` skill. Adds the `/deploy-list` slash command surface
  to dhpk; skill body already supports the generic preset matrix
  (php-yii-zdpos / php-yii / laravel / node / python / generic).
- **`commands/goal-ex.md`** + **`skills/goal-ex/`** — extended `/goal`
  meta-workflow that runs ≤3 parallel Explore subagents to inventory a
  project and propose `.claude/{skills,agents,rules}` + per-layer
  CLAUDE.md additions. Skill plus command; first true zdpos-only
  contribution that dhpk did not previously stub.
- **`commands/ui-ux-verify.md`** — command shell that delegates to the
  existing `ui-ux-verifier` agent (no `-zdpos_dev` suffix; URL regex
  parameterised as `<app-host>` instead of the original `posdev.test`).
  Default mode lists currently-changed OpenSpec specs and prompts for
  one to verify; URL mode bypasses the spec lookup. Requires the
  external OpenSpec plugin for the Default Mode flow (URL Mode works
  standalone).
- **`modules/yii-1.1/commands/yii1-security-audit.md`** — per-module
  command (loaded only when `yii-1.1` is in `userConfig.modules`).
  Slash command for the existing `yii1-security-audit` skill in the
  same module; routes through the 8-item audit checklist
  (AUTH / CSRF / XSS / SQL / CFG / LOGIC / FILE) and emits a
  type-coded report. Module manifest updated:
  `provides.commands: [yii1-security-audit]`.
- **`rules/`** — new resource layer. Three plain-markdown files,
  cross-referenced by existing skills (`dhpk-execution-policy`,
  `tool-routing`) and consumable from downstream `CLAUDE.md` via the
  `${CLAUDE_PLUGIN_ROOT}/rules/<file>.md` path. **Not** registered in
  `plugin.json` — the Claude Code plugin manifest schema has no
  `rules` key, by design. Downstream projects opt in by referencing
  them; nothing auto-loads.
  - `rules/execution-policy.md` — task-mode taxonomy
    (small change / small bug / medium change / unknown-cause bug /
    new feature / architecture change), sentinel chain rule when
    multiple `.pending-*` files coexist, AI-judgment back-stop for
    triggers that hooks cannot match by path alone.
  - `rules/tool-routing.md` — decision tree for code-search tools
    (cx / gitnexus / claude-mem / Read / Grep), tie-breakers, sub-agent
    prompt boilerplate guidance.
  - `rules/anti-rationalization.md` — 5 common self-justification
    patterns when about to skip a reviewer / TDD / sentinel step, plus
    counter-arguments. On-demand load (not always-on).

### Refactored

- **`modules/yii-1.1/references/patterns.md`** — appended a "Refactor
  cleanup checklist (Yii 1.1)" section absorbing six Yii-1.1-specific
  trap knowledge items from zdpos's local `refactor-cleaner` agent
  prose (stale `relations()`, disabled `before/afterSave` hooks,
  obsolete module aliases in `protected/config/main.php`, base-
  controller-registered Behaviors that descendants override, orphan
  view partials with dead `CHtml::scriptFile()` calls, and the
  Yii-alias-autoload reason rename MUST go through `gitnexus_rename`).
  Original zdpos agent body had these mixed into the role description;
  dhpk splits them into the framework module's reference notes so the
  language-agnostic `refactor-cleaner` agent itself stays small. The
  agent body already cross-links to the module overlays, so no agent
  edit is needed.
- **`skills/execution-checklist/SKILL.md`** — absorbed three cross-
  cutting patterns from zdpos's local skill: (a) a fourth Per-reply
  mandatory box, **Edit-before-Read enforced**, with the matching
  error message keywords listed; (b) a new sub-section, **Mass refactor
  preference order** (`sed` / formatter > `Edit replace_all` > N-deep
  multi-file Edit) — historically the highest-leverage anti-pattern
  in cross-file mechanical replacements; (c) two new Conditional table
  rows — bare `glob` expansion in shells without `nullglob` (a sentinel-
  check trap in zsh / dash / BusyBox), and the `clear-sentinel.sh` path
  SSOT (`${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh`, NOT
  `${CLAUDE_PROJECT_DIR}/.claude/scripts/...`). Specific high-volume
  table names (e.g. `records`, `orders`, `stock`) deliberately kept
  out — those belong in each consuming project's own rules, not in
  dhpk's generic skill.

### Verified

- `plugin.json` validates against the Claude Code v2.1.150 plugin
  manifest schema after the agents[] addition and per-module command
  registration via `module.yaml.provides.commands`.
- `modules/yii-1.1/module.yaml` matches the existing `modules/js/`
  shape (which already ships a per-module command,
  `ts-check-status`).
- New `rules/` layer is purely additive — no existing skill / agent
  body relies on it for hard dependency; cross-refs are advisory.

### Deferred

- **`commands/create-dev.md` not ported** — zdpos's `/create-dev` is
  the routing command that triggers `adaptive-dev-workflow` skill
  before implementation. The skill carries deep references to
  zdpos-suffixed agents (`tdd-guide-zdpos_dev`, `architect-zdpos_dev`,
  etc.) and a project-specific `references/projects-zdpos.md` knowledge
  file, plus four `.py` orchestration scripts. Porting requires a
  proper skill de-identification pass — not a fast win for v0.4.0.
  Tracked for a future release.

### Non-changes

- Hook architecture untouched. dhpk's 5-slot `userConfig.review_agents`
  remains unchanged this release. Adding a 6th slot to formally
  support migration-style reviewers is tracked for v0.5.x.
- No existing skill / agent / command body was renamed or removed.
- No userConfig defaults changed.

## 0.3.2 — 2026-05-26 — Validate release workflow stdin pipe

Purely a CI-infrastructure release. v0.3.1 tag-push failed at the GitHub
Release step because the workflow inlined CHANGELOG body directly into a
gh release create --notes argument; the runner shell then tried to expand
backticks and dollar-paren in the body as command substitutions, emitting
a flood of command-not-found errors. The release page for v0.3.1 was
manually patched in afterwards. The workflow fix was committed to main as
4689a3f but has not yet been exercised by an actual tag push. This
release exists solely to drive that exercise on a real CI run.

### Fixed

- .github/workflows/release.yml now passes the extracted notes through
  an env: variable and streams them via printf piped into
  gh release create --notes-file -, so CHANGELOG bodies that contain
  backticks or dollar-paren can no longer be interpreted by the runner
  shell. Future releases whose CHANGELOG entry uses code spans are now
  safe to tag-push without manual recovery.

### Verified

- If you can read this release body on the GitHub Releases page with
  the markdown intact, the fix landed: this body itself is deliberately
  written WITHOUT backticks or dollar-paren so that a defective workflow
  would still succeed to publish the page, while the v0.3.1 body further
  down in CHANGELOG.md (which is full of code spans) exercises the
  awk-extract step on shell-hostile content during local pre-verify.

### Non-changes

- No agent, skill, command, module, hook, or manifest change beyond the
  version bump in .claude-plugin/plugin.json and the pinned-version
  example in README.md. Users on v0.3.1 have no functional reason to
  upgrade; this is a release-pipeline confidence checkpoint.

## 0.3.1 — 2026-05-26 — Fix plugin.json agents schema regression + SKILL.md frontmatter

v0.3.0 shipped two latent manifest bugs that turned out to be installation
blockers in the wild. A consumer (`hmj1026/devkit`) tried to install the
new `library-author` module and got back:

```
Plugin dhpk has an invalid manifest file at
~/.claude/plugins/cache/dhpk/dhpk/8cb34b318356/.claude-plugin/plugin.json.
Validation errors: agents: Invalid input
```

The cache had **already fetched** the v0.3.0 commit successfully — the
manifest validator rejected it post-fetch, so no part of the plugin
loaded. The promised library-author module wasn't merely missing; the
entire dhpk plugin was unreachable.

### Fixed

- **`.claude-plugin/plugin.json` — `agents` field schema**: v0.3.0 used
  directory paths (`["./agents/", "./modules/library-author/agents/"]`),
  but the Claude Code v2.1.150 plugin manifest schema requires individual
  `.md` file paths (per
  [plugins-reference](https://code.claude.com/docs/en/plugins-reference.md),
  line 384 / 567). Switched to enumerating each agent `.md`:
  15 root agents + 1 module agent (`polyfill-reviewer.md`).
  `commands` schema was looser and tolerated `["./commands/"]`, so it
  stays unchanged this release — only the failing field was touched.
- **`skills/polyfill-version-matrix-audit/SKILL.md` frontmatter**: the
  `description` value contained `Symptoms that trigger this skill:` —
  a mid-line `:` + space + text, which YAML parses as a mapping value
  inside the already-implicit description mapping. Result: YAML parser
  emitted `Unexpected token` and Claude Code **silently loaded the skill
  with empty metadata** (no `name`, no `description`, no matchers). The
  skill was effectively inert for matching. Rewrote `description` as a
  folded block scalar (`>-`) and replaced the inner `:` with ` — ` to
  remove the parse ambiguity. Wording preserved so claude-mem corpora and
  skill matchers still hit the same keywords.
- **`.claude-plugin/marketplace.json` description**: still listed
  `(php-5.6, yii-1.1, phpunit-5.7)` — three of the seventeen modules
  dhpk ships today. Synced to the v0.3.x surface (PHP 5.6/7.4/8.x,
  Yii 1.1, PHPUnit 5.7/9/10/11, Laravel 6–11, JS, library-author) and
  added the 6-slot reviewer note.
- **`.claude-plugin/plugin.json` `description`**: same drift — updated.
- **`README.md`** — synced the top-line summary, agents/modules count
  table, `userConfig.modules` ships list, Modules section bodies, and
  repository-layout tree to actually describe what v0.3.x contains.
  Bumped the pinned-version example from `v0.2.1` to `v0.3.1`. Added a
  modern-Laravel-library install example alongside the legacy PHP/Yii
  example.

### Verified

- `claude plugin validate /home/paul/projects/dhpk/.claude-plugin/plugin.json`
  → `✔ Validation passed` (no `agents: Invalid input`, no SKILL frontmatter
  error in the bundled skill scan).
- `claude plugin validate /home/paul/projects/dhpk/` (full plugin +
  marketplace) → both pass.
- Downstream cache invalidation round-trip on `hmj1026/devkit`:
  - `rm -rf ~/.claude/plugins/cache/dhpk/`
  - new Claude Code session
  - no "Invalid manifest" error
  - `~/.claude/plugins/cache/dhpk/dhpk/0.3.1/` materialises
  - `/agents` lists `dhpk:polyfill-reviewer`
  - editing a `.php` file containing `version_compare` writes
    `.pending-polyfill-review` and the next prompt fires the reviewer.

### Upgrade notes

- Anyone who tried to install v0.3.0 and saw the "invalid manifest"
  error: clear `~/.claude/plugins/cache/dhpk/` once, then reinstall;
  v0.3.1 onwards is the first **actually-installable** release in the
  0.3.x line.
- v0.3.0 git tag and GitHub Release remain in place (no force-push) to
  avoid breaking downstream caches that did manage to extract it before
  validation. They should be treated as superseded by 0.3.1.

## 0.3.0 — 2026-05-25 — Ship library-author module (sixth-color polyfill reviewer)

Three previous commits landed the `library-author` module on `main` —
agent body, module skills, sentinel hook, references — but `plugin.json`
was never updated to register the new surface. Result: a sibling project
(`hmj1026/devkit`, multi-major PHP polyfill library) explicitly enabled
`library-author` in its `.claude/settings.local.json`, expected the
sixth-color reviewer to fire on guard edits, and got nothing. Symptom
was silent: `reload-plugins` reported the same skill/agent counts as
0.2.4 because Claude Code never saw the module declarations. This
release is the manifest catch-up plus a slash-command alias for the
matrix-cell onboarding skill.

### Added

- `modules/library-author/` — first shipped via `plugin.json` declarations.
  - `agents/polyfill-reviewer.md` — sentinel-driven reviewer fired by
    `.pending-polyfill-review`; sixth color filling the gap left by
    code/db/sec/frontend/doc reviewers, which don't reason about
    version-guard trees. Companion to (not replacement for) the
    manual-invoke `polyfill-version-matrix-audit` skill and the
    diff-scope `version-matrix-impact-reviewer` agent.
  - `skills/matrix-cell-onboard/` — checklist + procedure for adding a
    new PHP/Laravel/PHPUnit/Monolog cell to a multi-major library's CI
    matrix. Cross-checks composer constraints, workflow rows, Testbench
    mapping; triggers polyfill-coverage check for the new cell's
    versions.
  - `skills/openspec-artifact-guard/` — `specs` vs `spec-delta` naming
    enforcement and tasks.md ↔ git log drift detection for OpenSpec
    workflows.
  - `skills/library-dual-testsuite-map/` — Core vs Laravel (or
    analogous) testsuite boundary helper.
  - `hooks/post-edit-polyfill-sentinel.sh` — PostToolUse Edit/Write/
    MultiEdit hook; writes `.pending-polyfill-review` when an edited
    `.php` file body matches `guard_patterns`. Fanned out by the core
    `scripts/hooks/post-edit-dispatch.sh` when `library-author` is in
    `DHPK_ACTIVE_MODULES`.
  - `references/polyfill-patterns.md` — severity rubric + catalogued
    guard shapes (`critical`/`high`/`medium`/`low`).
  - `references/openspec-naming-gotchas.md` — `specs` vs `spec-delta`
    artifact gotcha catalogued.
  - `module.yaml` — `library_author.guard_patterns` (default extended
    regex) and `library_author.skip_paths` (path prefixes to exclude).
    Both override-able per project.
- `commands/matrix-cell-onboard.md` — root-level slash alias so
  `/dhpk:matrix-cell-onboard` resolves; thin wrapper that invokes the
  module-scoped skill of the same name when `library-author` is active.

### Fixed (manifest)

- `.claude-plugin/plugin.json` — three latent declaration gaps closed.
  Before this release the module bodies existed in `main` but Claude
  Code never loaded them:
  - `skills[]` did not list `./modules/library-author/skills/` —
    `matrix-cell-onboard` / `openspec-artifact-guard` /
    `library-dual-testsuite-map` were unreachable.
  - No `agents[]` declaration at all — root `./agents/` worked by
    auto-discovery, but module-scoped agents (`polyfill-reviewer`) did
    not. Explicit `agents: ["./agents/", "./modules/library-author/agents/"]`
    closes the gap and future-proofs additional module-scoped agents.
  - No `commands[]` declaration — added `["./commands/"]` for the same
    future-proofing reason.
- `userConfig.modules.description` — adds `library-author` to the ships
  list and documents the sixth-color sentinel wiring.

### Verified

- `claude plugin validate <repo> --strict` passes against schema.
- Cache invalidation round-trip: bumping `version` to `0.3.0` triggers
  Claude Code to re-extract a fresh snapshot into
  `~/.claude/plugins/cache/dhpk/dhpk/0.3.0/` on next session start;
  marketplace pulls latest `main` automatically.
- `polyfill-reviewer` agent visible in `/dhpk:claude-health` agent
  catalog when `library-author` module is enabled.
- `/dhpk:matrix-cell-onboard` resolves to the alias command body and
  delegates to the module skill.

### Upgrade notes

- Existing projects with `library-author` in
  `pluginConfigs.dhpk@dhpk.options.modules` (e.g. `hmj1026/devkit`)
  start receiving the sixth-color sentinel automatically on next
  session — no project-side change required.
- Projects that do NOT need polyfill review can leave `library-author`
  out of their modules list; the new declarations are additive and the
  module ships dormant otherwise.

## 0.2.4 — 2026-05-25 — Honour project-level pluginConfigs overrides

Claude Code injects `userConfig` into hooks via `CLAUDE_PLUGIN_OPTION_*`
env vars, but resolves only the **global** `~/.claude/settings.json`
`pluginConfigs` entry. A developer working on multiple projects with
different stacks (e.g. a Yii 1.1 monolith + a Laravel package library)
saw whichever stack their global config named — even when the project
explicitly declared its own modules in `.claude/settings.local.json`.
Symptom in the wild: `devkit` (a PHP 7.3–8.2 / Laravel 6–11 library)
loaded `php-5.6,yii-1.1,phpunit-5.7,js` because the global config
belonged to a sibling Yii project.

### Added

- `scripts/hooks/_lib/load-project-config.sh` — sourced by every dhpk
  hook entrypoint; reads the project `.claude/settings.local.json`
  (fallback `.claude/settings.json`) and overrides
  `CLAUDE_PLUGIN_OPTION_*` env vars from
  `pluginConfigs.dhpk@dhpk.options.*`. Keys absent from the project
  override are left at the global value (least-surprise: project
  overrides only what it states).

### Fixed

- `scripts/hooks/session-start.sh` — sources the loader before reading
  any plugin option, so module activation, hook profile, and docker
  container list all reflect the project's intent.
- `scripts/hooks/post-edit-dispatch.sh`, `scripts/hooks/pre-bash-dispatch.sh` —
  source the loader and re-derive `DHPK_ACTIVE_MODULES` from
  `CLAUDE_PLUGIN_OPTION_MODULES` when env did not propagate from
  session-start. Module-specific hooks (php-cs-fixer, ESLint, etc.) now
  fire in projects that override modules locally.
- `scripts/hooks/stop-review-reminder.sh` — loader sourced **before**
  `_lib/payload.sh` (which reads `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS`
  at source-time), so per-project `review_agents` overrides reach the
  sentinel reminders.
- `.claude-plugin/plugin.json` — `userConfig.modules.description`
  documents the new precedence rule: project overrides global.

### Precedence (new, documented)

```
project pluginConfigs > global pluginConfigs > userConfig defaults
```

## 0.2.3 — 2026-05-23 — Reduce harness friction in long sessions

A long-running session on a sibling project (`hmj1026/devkit`, Wave-0
closure + Wave-1 implementation, 7 commits) surfaced four high-frequency
friction points in the review-sentinel pipeline. Each was traced back to
a specific script or agent body; this release applies the four fixes
identified in the audit at
`devkit/.claude/artifacts/audits/harness-audit-2026-05-23.md`
(findings #3, #4, #5, #6).

### Fixed

- `scripts/hooks/post-edit-remind.sh` — sentinel append is now idempotent.
  Each `.pending-*` file is checked for the candidate path before write
  (`cut -d' ' -f3- | grep -Fxq`), so repeated edits to the same file no
  longer accumulate duplicate lines. Makes `stop-review-reminder`'s
  `wc -l` count truthful and reduces the work for reviewer agents that
  iterate the sentinel.
- `scripts/hooks/pre-bash-guard.sh` — `git push` block now intersects
  sentinel-listed paths with `git diff --name-only HEAD` (uncommitted)
  ∪ `git diff --name-only --cached` (staged). Stale sentinels from
  already-committed work no longer block pushes — once HEAD moves past
  the edited files, the intersection comes up empty and the push is
  allowed. Eliminates the "rm sentinel, push, rm sentinel, push" loop
  that dominated the devkit session.
- `scripts/hooks/reap-stale-sentinels.sh` — accepts `--threshold-minutes N`
  (default `1440` = 24h, unchanged for the Stop hook caller) and `--clear`
  (auto-rm stale files instead of warn-only). `pre-bash-guard.sh` now
  invokes it with `--threshold-minutes 60 --clear` before its push-block
  check, so a sentinel leaked by a crashed reviewer can't block pushes
  for more than 60 minutes.
- `agents/code-reviewer.md` — stack-aware syntax rules. The agent now
  detects the project's PHP floor from `composer.json` and applies the
  matching ruleset: PHP 5.6/7.0 floor keeps the no-return-types rule;
  PHP 7.1+ floor allows return types, `??`, etc. A new "LSP exceptions"
  block documents that subclass signatures forced by interfaces
  (`PHPUnit\Framework\TestCase::setUp(): void`, `ArrayAccess` tentative
  types, `HttpExceptionInterface` v6+) MUST match the parent — never
  flagged as style violations. Laravel-specific trap list added
  alongside the existing Yii 1.1 traps; both activate only when their
  framework is detected.

### Verified

- `bash scripts/hooks/post-edit-remind.sh` reproducer with two edits to
  the same path → sentinel now has 1 line (was 2 pre-fix).
- `pre-bash-guard.sh` push-block reproducer: commit a doc edit then
  attempt `git push` with sentinel still listing the now-committed file
  → push proceeds (was blocked pre-fix).
- `reap-stale-sentinels.sh --threshold-minutes 60 --clear` against a
  `touch -t 202605220000`-aged sentinel → file removed; subsequent
  `pre-bash-guard.sh` push attempt proceeds.
- `dhpk:code-reviewer` re-run against `tests/Ui/Trail/TrailTest.php`
  (PHPUnit 8+ with `setUp(): void`) → no false positive on the typed
  return declaration; the new LSP-exceptions section is honoured.

## 0.2.2 — 2026-05-22 — Align with current Claude Code plugin CLI

Two regressions surfaced when test-installing v0.2.1 against Claude Code
v2.1.148: the plugin failed to load because Claude now auto-discovers
`hooks/hooks.json` (so the explicit `manifest.hooks` ref produced a
"Duplicate hooks file" load error), and the documented `--plugin-option`
flag no longer exists — the install CLI takes `--config KEY=VALUE`.

### Fixed

- `.claude-plugin/plugin.json` — drop the `"hooks": "./hooks/hooks.json"`
  reference. Claude Code v2.1+ auto-loads the standard hooks path, so the
  explicit reference triggers `Hook load failed: Duplicate hooks file
  detected`. The hook wiring is unchanged on disk; only the redundant
  manifest entry was removed.
- README.md / README.zh-TW.md — replace every `--plugin-option KEY=VALUE`
  example with `--config KEY=VALUE` (the actual flag accepted by
  `claude plugin install`). Drops a Troubleshooting row that referenced
  the obsolete failure mode.
- `scripts/install.sh` — emit `--config` instead of `--plugin-option` in
  the resolved command (the shipped wizard had been emitting an unknown
  CLI flag since the rename).
- `commands/dhpk-setup.md` — point users at `/plugin configure dhpk@dhpk`
  for module changes (the current native in-session configurator) and the
  CLI uninstall+install pair when working from a terminal. The previous
  text referenced `claude plugin reinstall`, which is not a CLI command.
- `docs/docker-setup.md` — same fix in the "disable the check
  temporarily" recipe.
- `manifests/install-profiles.json` and `manifests/module-catalog.json` —
  CLI examples in description/notes strings now use `--config`.
- `docs/design/bootstrap-dhpk-plugin/specs/` — historical design spec
  scenarios use `--config` for consistency. Behavior unchanged; these
  files are archived design notes, not live specs.

### Verified

- `claude plugin marketplace add hmj1026/dhpk` + `claude plugin install
  dhpk@dhpk` on Claude Code v2.1.148 → `Status: ✔ enabled` (previously
  `✘ failed to load`).
- `claude plugin validate ~/projects/dhpk --strict` — passes.

## 0.2.1 — 2026-05-22 — Unbundle OpenSpec wrappers

OpenSpec is now treated as an external optional integration. Generic
OpenSpec wrapper skills/commands are removed from this package — install the
[OpenSpec plugin](https://github.com/Fission-AI/OpenSpec) separately to get
them upstream. dhpk's own value-add helper `opsx-apply-resume` (long-running
OpenSpec session context handoff) is retained and works once OpenSpec is
installed.

### Removed

- 10 skills under `skills/openspec-*/`: `openspec-apply-change`,
  `openspec-archive-change`, `openspec-bulk-archive-change`,
  `openspec-continue-change`, `openspec-explore`, `openspec-ff-change`,
  `openspec-new-change`, `openspec-onboard`, `openspec-sync-specs`,
  `openspec-verify-change`. The 10 matching symlinks under `codex/skills/`
  are removed in parallel.
- `commands/opsx/` — the 10 OpenSpec slash-command wrappers
  (`apply`, `archive`, `bulk-archive`, `continue`, `explore`, `ff`, `new`,
  `onboard`, `sync`, `verify`).
- `"openspec"` keyword from `.claude-plugin/plugin.json`.

### Retained (dhpk's own value-add)

- `skills/opsx-load-context/`, `skills/opsx-post-obs/` — helper skills used
  by `opsx-apply-resume`'s save/resume lifecycle. Still mirrored under
  `codex/skills/`.
- `commands/opsx-apply-resume.md` — the long-running session context
  handoff wrapper. References upstream `openspec-continue-change` as an
  external dependency.
- `scripts/opsx-apply-resume/` — entire bash helper tree (unchanged).

### Moved

- `openspec/changes/bootstrap-dhpk-plugin/` → `docs/design/bootstrap-dhpk-plugin/`.
  The package's original design archive (proposal, design, tasks, specs)
  becomes static reference documentation, no longer OpenSpec-managed. The
  `.openspec.yaml` marker file is dropped along with the move. The
  previous `openspec/` `.gitignore` entry is removed.

### Documentation

- `README.md` / `README.zh-TW.md` — intro paragraph rewritten to call out
  OpenSpec as an external optional integration; counts updated
  (`~75 → ~65` commands, `~60 → ~50` core skills); repository-layout tree
  drops `openspec/` and `commands/opsx/`, gains `docs/design/`.
- `manifests/install-profiles.json` — `minimal` profile description no
  longer claims to ship "openspec workflow skills".
- `docs/recommended-permissions.md` — `Bash(openspec:*)` bullet clarified
  as relevant only when the OpenSpec plugin is installed.
- `skills/multi-ai-sync/references/platform-mapping.md` — header note
  added that `opsx/<cmd>` rows are N/A when OpenSpec is not installed.

### Verification

- `claude plugin validate ~/projects/dhpk --strict` passes.
- `find codex/skills/ -xtype l` returns empty (no dangling symlinks).
- `grep -rln "openspec-" skills/ commands/ agents/` returns only the
  intentional residual references (`multi-ai-sync`, `opsx-apply-resume`).
- `git log --follow docs/design/bootstrap-dhpk-plugin/proposal.md` —
  history not preserved because `openspec/` was `.gitignore`d in prior
  versions; the docs enter git history starting at v0.2.1.

## 0.2.0 — 2026-05-22 — JS module + 5-slot sentinel + deploy-list skill

### Sentinel infrastructure (5 slots)

- `scripts/hooks/_lib/payload.sh` `SENTINEL_NAMES` extends from 3 to 5:
  `.pending-review`, `.pending-db-review`, `.pending-security-review`,
  `.pending-frontend-review`, `.pending-doc-review`. `SENTINEL_LABELS`
  and the default `SENTINEL_AGENTS` extend in parallel. Consumers that
  iterate the array (`clear-sentinel.sh`, `reap-stale-sentinels.sh`,
  `stop-review-reminder.sh`, `pre-bash-guard.sh` push-block) extend
  automatically.
- `userConfig.review_agents` default now ships 5 entries:
  `[code-reviewer, database-reviewer, security-reviewer,
  frontend-reviewer, doc-reviewer]`. Override semantics unchanged.
- `scripts/hooks/post-edit-remind.sh` slot routing: `.md` files under
  harness / docs / openspec paths route to slot 4 (doc-reviewer); JS/TS
  edits still route to slot 0 (code-reviewer) by default; slot 3
  (frontend-reviewer) is fed by the `js` module's `module.yaml` triggers
  when active. `userConfig.review_trigger_extra_paths` now accepts the
  `fe:` and `doc:` slot prefixes in addition to `code:` / `db:` / `sec:`.
- `scripts/hooks/pre-bash-guard.sh` push-block message lists the
  matching agent name per pending sentinel (was: bare filename).
- `scripts/statusline/statusline.sh` `SHORT` labels extend to
  `code / db / sec / fe / doc`.

### New JS module (`modules/js/`)

Hybrid placement: the generic libs (`scripts/hooks/_lib/portable-sed.sh`
landed in v0.1.1, `_lib/payload.sh`) stay in core; JS-specific behaviour
lives in the opt-in module.

- `modules/js/module.yaml` — module manifest. Includes a `js:` block read
  by `js-tier-detect.sh` for `frontend_roots`, `core_files`,
  `vendor_globs` (project curates).
- `modules/js/hooks/_lib/js-tier-detect.sh` — source-only tier detector
  (`frontend / vendor / non-js`). Reads config from `module.yaml`;
  defaults to safe behaviour (everything in `js/` or `src/` subdirs is
  `frontend`).
- `modules/js/hooks/post-edit-js-lint.sh` — async-friendly per-edit
  ESLint feedback (always exits 0; stderr surfaces ≤ 5 findings; 10s
  timeout; silent skip when `npx` / `eslint.config.js` absent).
- `modules/js/hooks/pre-commit-js-validation.sh` — intercepts
  `git commit*`, runs `npm run <lint>` + `npm run <typecheck>` on staged
  JS/TS. Exits 2 to block on failure. `[skip-js-lint]` in the commit
  message bypasses.
- `modules/js/skills/js-lint-config/SKILL.md` — ESLint flat-config tier
  framework (Tier 1 strict / 1.5 core-exempt / 1.6 admin / 1.7
  deferred-migration / 2 tests / Global ignores), custom
  `no-restricted-syntax` AST selectors, legacy-globals three-list sync
  pattern.
- `modules/js/skills/js-static-check-strategy/SKILL.md` — per-leaf
  `// @ts-check` rollout playbook, line-anchored grep trap, leaf
  classification (typedef-widening-fixable vs permanent-exclude),
  tsconfig `exclude` strategy.
- `modules/js/commands/ts-check-status.md` — slash command that scans
  `${CLAUDE_PLUGIN_OPTION_JS_CHECK_PATH:-js/}` and renders the
  strict / transitional / unmarked split.
- `modules/js/references/static-checks.md` — always-loaded index.
- `modules/js/references/frontend-review-patterns.md` —
  `frontend-reviewer`'s grep templates when the module is active.

### Hook wrapper-dispatch model

- `scripts/hooks/post-edit-dispatch.sh` — wraps the existing
  `post-edit-remind.sh` and additionally backgrounds any
  `modules/<m>/hooks/post-edit-*.sh` for active modules.
- `scripts/hooks/pre-bash-dispatch.sh` — wraps `pre-bash-guard.sh` and
  synchronously runs any active module's `pre-bash-*.sh` /
  `pre-commit-*.sh` (non-zero exit blocks the bash call).
- `hooks/hooks.json` — PostToolUse Edit/Write/MultiEdit and PreToolUse
  Bash now point at the dispatchers. Stop / SessionStart wiring
  unchanged.
- `docs/hook-extension.md` — explains the dispatcher contract and how
  to author module hooks.

### New / migrated agents

- `agents/frontend-reviewer.md` — JS/TS reviewer, framework-agnostic.
  Loads `modules/js/references/frontend-review-patterns.md` for
  JS-module-specific detection when the module is active.
- `agents/doc-reviewer.md` — harness / policy / docs reviewer
  (frontmatter check, cross-reference validation, SSOT consistency,
  jargon discoverability). Haiku model.

### New skills

- `skills/deploy-list/` — cross-project / cross-platform deploy file
  list generator (schema=v1). Ships generic / node / python / laravel /
  php-yii presets. `evals/generic/` carries 6 synthetic fixtures (all
  pass byte-identical). `config.sh.example` documents the per-project
  template. `references/extended-presets.example/php-yii-acmeshop.sh`
  is a fully worked DDD-overlay-on-Yii example using a fictional
  company name.
- `skills/execution-checklist/SKILL.md` — end-of-task self-check
  (per-reply / conditional / task-end). Framework-agnostic.

### New userConfig knobs

| Key | Type | Default | Purpose |
|---|---|---|---|
| `js_lint_script` | string | `"lint"` | npm script invoked by JS module's pre-commit gate |
| `js_typecheck_script` | string | `"typecheck"` | npm script invoked by JS module's pre-commit gate |
| `js_check_path` | string | `"js/"` | path scanned by `/ts-check-status` |

`review_agents` default changed (3 → 5). `modules` description updated
to list `js`. `review_trigger_extra_paths` description updated to
mention `fe:` and `doc:` slot prefixes.

### Install profiles

- `manifests/install-profiles.json` adds `js-only` and `js-fullstack`
  profiles. `full` profile now includes `js`.
- `manifests/module-catalog.json` registers the `js` stack and the
  two new review slots (`fe`, `doc`).
- `scripts/install.sh` interactive flow prompts for all 5 reviewer
  agent names when the override-defaults branch is taken.

### Documentation

- `docs/hook-extension.md` — wrapper-dispatch contract + module-hook
  authoring guide.
- `docs/recommended-permissions.md` — recommended
  `.claude/settings.local.json` `permissions.allow` catalogue by stack
  (universal, PHP/Yii, JS/Node, Python, auxiliary). Plugin manifest
  does **not** ship permissions; this is reference documentation.

### Verification

- Repo-wide identifier audit: zero leaks of origin-project names,
  project-private class symbols, project-specific JS namespace, or
  project-specific repository-layer path. Negative-assertion eval files
  in `codex/skills/legacy-code-characterization/` and
  `modules/phpunit-5.7/skills/legacy-code-characterization/` are
  intentional — they assert agent outputs MUST NOT contain a list of
  enumerated names; those names appear in the eval *as the forbidden
  list*, not as live content.
- `bash -n` clean on all new and modified shell scripts.
- 5-slot sentinel end-to-end: `clear-sentinel.sh` derives whitelist
  from `SENTINEL_NAMES`; `pre-bash-guard.sh` push-block names all 5
  pending sentinels with their matching agent name.
- `skills/deploy-list/scripts/check-golden.sh` — generic suite 6/6
  PASS after the cross-project genericisation.

## 0.1.1 — 2026-05-22 — Cross-platform lib + sentinel resilience

Low-risk infrastructure additions. No behavioural change in the default
profile; all new behaviour is opt-in via `userConfig`.

### Added

- **`scripts/hooks/_lib/portable-sed.sh`** — source-only cross-platform `sed -i`
  wrapper (Linux/WSL GNU sed vs macOS BSD sed). Exposes `sed_inplace`. Reserved
  for future hooks that need in-place edits; the v0.1.1 hook set does not yet
  consume it.
- **`scripts/hooks/reap-stale-sentinels.sh`** — Stop-hook companion that
  inspects `.claude/artifacts/sessions/.pending-*` files and emits a STALE
  warning to stderr when any sentinel is older than 24h (likely review-agent
  crash). By design does not delete; prints the exact `clear-sentinel.sh`
  command to clear manually. Uses portable `stat` (Linux `-c %Y` / macOS
  `-f %m`). Wired into the Stop event as a second `async: true` hook.
- **`reap_stale_mcp_processes` userConfig** (boolean, default `false`) —
  when enabled, `session-start.sh` reaps older `gitnexus mcp` processes and
  keeps only the newest. Off by default; only useful for projects using the
  gitnexus MCP server. Skipped automatically when `pgrep` is missing.

### Changed

- **`scripts/hooks/clear-sentinel.sh`** — now sources `_lib/payload.sh` and
  derives `KNOWN_SENTINELS` from `SENTINEL_NAMES`. Behaviour identical
  today (3-slot) but automatically extensible when `SENTINEL_NAMES` grows.
- **`commands/code-review.md` → `commands/review-pending.md`** — renamed for
  naming clarity ("review the **pending** files" vs. "the `code-reviewer`
  agent"). Old name retained as a deprecated forwarding stub; will be
  removed in v1.0.0. `commands/INDEX.md` updated accordingly.
- **De-identification sweep** across `agents/refactor-cleaner.md`,
  `skills/git-smart-commit/SKILL.md`, `skills/pr-review/SKILL.md`,
  `skills/pr-review/scripts/check-unrelated-changes.sh`,
  `skills/harness-revise/scripts/harness-inventory.sh`, and
  `codex/skills/multi-ai-sync/scripts/multi_ai_sync_lib/agent_sync.py`:
  removed lingering origin-project identifiers and replaced them with
  generic placeholders / framework-agnostic phrasing.

### Verification

- `bash -n` clean on all modified shell scripts.
- Repo-wide identifier audit returns no matches for any origin-project name.
- Stop hook smoke: touched a stub sentinel with mtime > 24h; reap script
  printed `[reap-sentinels] STALE: ...` and exited 0 without deleting the
  file.
- `clear-sentinel.sh --all` still clears all three known sentinels with the
  refactor in place.

## 0.1.0 — 2026-05-21 — Initial release

First public release of `dhpk` — a generic, install-and-go Claude Code harness with an opt-in stack-module system and a parallel Codex CLI tree.

### Added

- **Plugin manifest** (`.claude-plugin/plugin.json`) with five `userConfig` knobs (see below).
- **Marketplace manifest** (`.claude-plugin/marketplace.json`) — single-entry catalog pointing at the repo root.
- **13 agents** under the `dhpk:` namespace (12 role-based + 1 `INDEX.md`): `architect`, `code-reviewer`, `database-reviewer`, `performance-analyzer`, `refactor-cleaner`, `security-reviewer`, `tdd-guide`, etc. Frontmatter descriptions are framework-agnostic; each notes the matching dhpk module for stack-specific traps.
- **74 commands** including `opsx/*` (10 OpenSpec workflow wrappers), `codex-*`, `code-review`, `create-pr`, `smart-commit`, `precommit`, `harness-audit`, `pr-review`, `feature-dev`, `feature-verify`, etc.
- **59 core skills + 5 module skills** (across 3 stack modules). Two new rules-as-skills: `tool-routing` and `dhpk-execution-policy`.
- **3 opt-in stack modules** with `module.yaml` metadata, skills, and references:
  - `php-5.6` — PHP 5.6 language baseline.
  - `yii-1.1` — Yii 1.1 framework (requires `php-5.6`).
  - `phpunit-5.7` — PHPUnit 5.7 patterns (requires `php-5.6`).
- **Sentinel-driven review hooks** (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`) with parameterised agent names, trigger paths, docker checks, and hook profile. Explicit `[hook-name] WARN: …` lines when modules are enabled but `python3` is missing.
- **8 hook scripts** under `scripts/hooks/`, including `_lib/payload.sh` (sentinel-array override via `CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS`), `post-edit-remind.sh`, `post-write-crlf-fix.sh` (with `python3` JSON-parse fallback when `jq` is absent), and `install-codex-skills.sh` for dual-track Codex CLI sync (symlink default, `--copy`, `--update`, `--force`; advisory `note:` when Codex CLI binary is missing from PATH).
- **Harness scripts**: `harness-audit.js`, `precommit-runner.js`, `verify-runner.js`, `gemini-adapt-agents.js`, `dep-audit.sh`, `codemaps/generate.ts`, `validate/validate-harness.sh`, `opsx-apply-resume/*.sh`.
- **Statusline script** (`scripts/statusline/statusline.sh`) — opt-in via project `settings.json`. Renders branch, staged/modified counts, docker status, profile, active modules, pending sentinels.
- **24 codex skills + 5 codex agents** under `codex/` for dual-assistant projects.
- **`manifests/install-profiles.json`** — curated module bundles (`minimal`, `legacy-php-yii`, `php-only`, `full`).
- **`codex/AGENTS.md`** — dual-harness expectations document.
- **`docs/subagent-prompt-template.md`** — source-reading and DB-access boilerplate to paste into sub-agent prompts.

### `userConfig`

| Key | Default | Purpose |
|-----|---------|---------|
| `hook_profile` | `"standard"` | Verbosity of hook output: `minimal` \| `standard` \| `strict` |
| `review_agents` | `["code-reviewer","database-reviewer","security-reviewer"]` | Three agents invoked by sentinel reminders (code, database, security) |
| `docker_containers` | `[]` | Container names checked at `SessionStart`; empty disables the check |
| `modules` | `[]` | Stack modules to enable; `requires:` validated at `SessionStart` (warning only) |
| `review_trigger_extra_paths` | `[]` | Extra path prefixes per reviewer slot, format `<slot>:<prefix>` where slot ∈ `code\|db\|sec` |

### Verification

- `claude plugin validate ~/projects/dhpk --strict` passes.
- Hook smoke tests:
  - `post-edit-remind.sh` writes `.pending-review` for a `.php` edit even with `python3` PATH-masked (extension default still fires).
  - `post-write-crlf-fix.sh` normalises CRLF with `jq` missing (`python3` fallback works).
- End-to-end install round-trip in a scratch project succeeded: `claude plugin marketplace add ~/projects/dhpk` → `claude plugin install dhpk@dhpk` → `claude plugin details dhpk` reports 127 skill+command entries, 13 agents, 4 hook events.
- `install-codex-skills.sh` populated `.codex/skills/` + `.codex/agents/` with symlinks; re-run printed `already up-to-date for dhpk v0.1.0`.

### Known limitations

- Some skill bodies and command bodies inside `skills/`, `modules/`, `codex/skills/` still reference PHP/Yii-flavored examples (e.g. `protected/`, AR patterns) without explicit "this is just an example" framing. These do not affect functionality on non-PHP projects but may confuse first-time readers. Deeper rewrites planned for v0.2.
