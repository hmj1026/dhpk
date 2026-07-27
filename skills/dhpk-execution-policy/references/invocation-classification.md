# Invocation classification decision table

SSOT for every Distributed Skill and Distributed Command's `explicit-only` /
`implicit-eligible` classification (`metadata.dhpk-invocation-class`). Reviewed
once per entry against maximum authority, not inferred from descriptions or
existing runtime flags. See `openspec/changes/clarify-dhpk-skill-invocation-policy/design.md`
decision 2 for the full rule; summarized here:

**explicit-only** — any normal path can initiate: setup, installation,
credentials/session configuration, OpenSpec apply or another broad execution
workflow, release, commit, push, pull-request creation, deployment,
publication, external-system writes, batch governance (bulk mutation of the
harness/policy surface itself), or orchestration that starts another
high-authority workflow.

**implicit-eligible** — analyze, review, design, test, verify, route tools, or
implement within an already-authorized request. Reversible workspace edits
inside the user's current request do not by themselves force explicit-only.

Class reflects maximum authority and does not change with flags — a
lower-authority mode (e.g. a read-only default) does not make a high-authority
entry (one whose flag enables broad mutation) implicit-eligible.

## Root skills (`skills/*/SKILL.md`) — 68 entries

### explicit-only (14)

| Skill | Rationale |
|---|---|
| `agy-commit` | Delegates actual `git commit` execution via agy-cli. |
| `claude-health` | Includes plugin version sync / installed-asset sync — installation-adjacent. |
| `continuous-learning-v2` | Evolves instincts into new skills/commands/agents — creates new distributed entries. |
| `create-skill` | Creates new distributed skill packages. |
| `git-smart-commit` | Groups and executes `git commit` across the working tree. |
| `harness-fill` | Already explicit-only. One-shot bulk `.claude/` infrastructure generation (batch governance). |
| `harness-revise` | Trims/rewrites the harness tree in bulk (batch governance); tools include `rm`, `chmod +x`. |
| `multi-ai-sync` | Applies cross-platform (Codex/Gemini/Antigravity) sync mutations — broad orchestration across surfaces. |
| `op-session` | Initializes a 1Password CLI session — credentials/session configuration. |
| `opsx-apply-goal` | Generates an unattended OpenSpec-apply session — initiates a broad apply workflow. |
| `project-setup` | First-time project setup / CLAUDE.md initialization. |
| `release-creator` | Cuts a release (version bump, changelog, tag). |
| `repo-intake` | Already explicit-only. One-time project onboarding/inventory (setup-adjacent). |
| `rules-distill` | Writes/revises repo-wide policy rule files (batch governance). |

### implicit-eligible (54)

All other root skills: `adaptive-dev-workflow`, `agent-architecture-audit`,
`agy-fast-worker`, `bug-fix`, `bug-investigation`, `code-explore`,
`code-investigate`, `codex-architect`, `codex-brainstorm`, `codex-bridge`,
`codex-cli-review`, `codex-code-review`, `codex-explain`, `codex-implement`,
`composer-package-hygiene`, `create-request`, `de-ai-flavor`, `deploy-list`,
`dhpk-execution-policy`, `doc-review`, `execution-checklist`,
`feasibility-study`, `feature-dev`, `feature-verify`, `git-investigate`,
`gitnexus-cli`, `gitnexus-debugging`, `gitnexus-exploring`, `gitnexus-guide`,
`gitnexus-impact-analysis`, `gitnexus-refactoring`, `harness-budget`,
`issue-analyze`, `laravel-package-author`, `laravel-testbench-matrix`,
`next-step`, `opsx-load-context`, `opsx-post-obs`,
`polyfill-version-matrix-audit`, `post-dev-test`, `pr-review`,
`project-audit`, `prompt-optimize`, `risk-assess`, `security-review`,
`skill-health-check`, `skill-judge`, `skill-scout`, `skill-stocktake`,
`software-architecture`, `tdd`, `tech-spec`, `test-review`, `tool-routing`.

Notes on close calls:
- `codex-bridge` implements/reviews within an already-authorized task (like
  `fast-worker`); it does not itself decide to commit, release, or publish.
- `deploy-list` only generates a checklist (deterministic-first, tool output
  is immutable) — it does not execute a deploy.
- `multi-ai-sync` is explicit-only despite its dry-run/approval gates, because
  maximum authority (the `apply` path) can mutate multiple external-surface
  configs — an internal confirmation gate does not lower the class.

## Module skills (`modules/*/skills/*/SKILL.md`) — 37 entries

All implicit-eligible: these are stack reference/guidance packages (language
and framework "notes," lint/type-check strategy, test strategy) loaded to
inform in-scope implementation or review. None can setup, install, commit,
release, or write externally. This includes `matrix-cell-onboard` (a guided
checklist for CI-matrix cells — no elevated tools, editing stays within the
already-authorized library-authoring request).

## Commands (`commands/*.md`) — 45 entries

Only `matrix-cell-onboard.md` names a canonical skill 1:1 (paired; inherits
`implicit-eligible` from its skill). The remaining 44 are unpaired and own
their class directly.

### explicit-only (14)

| Command | Rationale |
|---|---|
| `create-pr` | Creates a GitHub PR (`gh pr create`). |
| `create-release` | Cuts a release. |
| `do` | Top-level Smart Router; can reach any downstream workflow including explicit-only ones — kept explicit-only itself per the "broad orchestration" category. |
| `evolve` | Already explicit-only. Generates evolved skill/command/agent structures. |
| `harness-govern` | Read-only by default, but `--fix` mutates the harness in bulk; class reflects maximum authority, not the default mode. |
| `install-hooks` | Installation. |
| `install-rules` | Installation (writes into a consumer project's `.claude/rules/`). |
| `install-scripts` | Installation. |
| `instinct-import` | Already explicit-only. Ingests instinct data from a file **or URL** into persistent behavioral config — untrusted external input shaping future agent behavior. |
| `opsx-apply-resume` | Already explicit-only. Resumes/continues an unattended OpenSpec-apply session. |
| `promote` | Already explicit-only. Promotes an instinct into a new skill/command/agent — creates a new distributed entry. |
| `setup` | Already explicit-only. Interactive plugin (re)configuration. |
| `smart-commit` | Executes `git commit` in batches. |
| `zh-tw` | Already explicit-only. Toggles a persistent session/locale configuration. |

### implicit-eligible (31, incl. `matrix-cell-onboard` inherited)

`check-coverage`, `check-skill`, `codex-review-branch`, `codex-review-doc`,
`codex-review-fast`, `codex-review`, `codex-security`, `codex-test-gen`,
`codex-test-review`, `create-dev`, `deep-analyze`, `dep-audit`, `doc-refactor`,
`git-worktree`, `harness-audit`, `instinct-export`, `instinct-status`,
`matrix-cell-onboard`, `merge-prep`, `pr-summary`, `precommit-fast`,
`precommit`, `project-brief`, `review-pending`, `review-spec`, `simplify`,
`spec-mine`, `ui-ux-verify`, `update-codemaps`, `update-docs`, `verify`.

### Reclassified from a pre-existing restriction (reviewed, not inherited)

Per the design decision that existing flags are never adopted as canonical
without review: `instinct-export` and `instinct-status` currently carry
`disable-model-invocation: true` but have no write authority beyond reading
and exporting the user's own already-local instinct data — reclassified
`implicit-eligible`. `instinct-import` keeps its explicit-only restriction
(see rationale above): the group's existing flags were not uniformly correct.

## Before/after: newly restricted entries (task 4.4)

These 17 entries had no Claude/Codex invocation restriction before this
change and are becoming `explicit-only`. Their explicit invocation name is
unchanged; only automatic model selection is disabled.

Skills: `agy-commit`, `claude-health`, `continuous-learning-v2`,
`create-skill`, `git-smart-commit`, `harness-revise`, `multi-ai-sync`,
`op-session`, `opsx-apply-goal`, `project-setup`, `release-creator`,
`rules-distill`.

Commands: `create-pr`, `create-release`, `do`, `harness-govern`,
`smart-commit`.

## Before/after: newly eligible entries

`instinct-export` and `instinct-status` had `disable-model-invocation: true`
before this change and are becoming `implicit-eligible` (see rationale
above).

## Description migration (tasks 4.1-4.3)

All 14 explicit-only skills carried a stale `Use when:` trigger phrase left
over from before this change (dead routing bait once
`disable-model-invocation: true` is set) — each was rewritten to a concise
effect-oriented lead sentence while keeping its `Not for:` / `Output:`
content unchanged: `agy-commit`, `claude-health`, `continuous-learning-v2`,
`create-skill`, `git-smart-commit`, `harness-fill`, `harness-revise`,
`multi-ai-sync`, `op-session`, `opsx-apply-goal`, `project-setup`,
`release-creator`, `repo-intake`, `rules-distill`. Two implicit-eligible
skills were missing a routing cue outright and got one added:
`codex-bridge` (no `Use when` trigger, no `Output:` cue) and
`feature-verify` (no `Output:` cue). `tests/description-invocation-cues.test.js`
enforces both directions going forward — implicit-eligible retains all
three cues, explicit-only drops the `Use when` trigger.
