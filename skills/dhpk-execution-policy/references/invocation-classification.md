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
| `dhpk-agy-commit` | Delegates actual `git commit` execution via agy-cli. |
| `dhpk-claude-health` | Includes plugin version sync / installed-asset sync — installation-adjacent. |
| `dhpk-continuous-learning-v2` | Evolves instincts into new skills/commands/agents — creates new distributed entries. |
| `dhpk-create-skill` | Creates new distributed skill packages. |
| `dhpk-git-smart-commit` | Groups and executes `git commit` across the working tree. |
| `dhpk-harness-fill` | Already explicit-only. One-shot bulk `.claude/` infrastructure generation (batch governance). |
| `dhpk-harness-revise` | Trims/rewrites the harness tree in bulk (batch governance); tools include `rm`, `chmod +x`. |
| `dhpk-cross-agent-sync` | Applies cross-platform (Codex/Gemini/Antigravity) sync mutations — broad orchestration across surfaces. |
| `dhpk-onepassword-session` | Initializes a 1Password CLI session — credentials/session configuration. |
| `dhpk-opsx-apply-goal` | Generates an unattended OpenSpec-apply session — initiates a broad apply workflow. |
| `dhpk-project-setup` | First-time project setup / CLAUDE.md initialization. |
| `dhpk-release-creator` | Cuts a release (version bump, changelog, tag). |
| `dhpk-repo-intake` | Already explicit-only. One-time project onboarding/inventory (setup-adjacent). |
| `dhpk-rules-distill` | Writes/revises repo-wide policy rule files (batch governance). |

### implicit-eligible (54)

All other root skills: `dhpk-adaptive-dev-workflow`, `dhpk-agent-architecture-audit`,
`dhpk-agy-fast-worker`, `dhpk-bug-fix`, `dhpk-root-cause-investigation`, `dhpk-codebase-exploration`,
`dhpk-code-investigate`, `dhpk-codex-architect`, `dhpk-codex-brainstorm`, `dhpk-codex-bridge`,
`dhpk-codex-cli-review`, `dhpk-change-review`, `dhpk-codex-explain`, `dhpk-codex-implement`,
`dhpk-composer-package-hygiene`, `dhpk-create-request`, `dhpk-de-ai-flavor`, `dhpk-deploy-list`,
`dhpk-execution-policy`, `dhpk-doc-review`, `dhpk-execution-checklist`,
`dhpk-feasibility-study`, `dhpk-feature-dev`, `dhpk-feature-verify`, `dhpk-git-history-investigation`,
`dhpk-gitnexus-cli`, `dhpk-gitnexus-debugging`, `dhpk-gitnexus-exploring`, `dhpk-gitnexus-guide`,
`dhpk-gitnexus-impact-analysis`, `dhpk-gitnexus-refactoring`, `dhpk-harness-budget`,
`dhpk-issue-analyze`, `dhpk-laravel-package-author`, `dhpk-laravel-testbench-matrix`,
`dhpk-next-step`, `dhpk-opsx-load-context`, `dhpk-opsx-post-observation`,
`dhpk-polyfill-version-matrix-audit`, `dhpk-post-dev-test`, `dhpk-pr-review`,
`dhpk-project-audit`, `dhpk-prompt-optimize`, `dhpk-risk-assess`, `dhpk-security-review`,
`dhpk-skill-health-audit`, `dhpk-skill-quality-judge`, `dhpk-skill-scout`, `dhpk-skill-stocktake`,
`dhpk-module-design`, `dhpk-tdd-workflow`, `dhpk-tech-spec`, `dhpk-test-review`, `dhpk-tool-routing`.

Notes on close calls:
- `dhpk-codex-bridge` implements/reviews within an already-authorized task (like
  `fast-worker`); it does not itself decide to commit, release, or publish.
- `dhpk-deploy-list` only generates a checklist (deterministic-first, tool output
  is immutable) — it does not execute a deploy.
- `dhpk-cross-agent-sync` is explicit-only despite its dry-run/approval gates, because
  maximum authority (the `apply` path) can mutate multiple external-surface
  configs — an internal confirmation gate does not lower the class.

## Module skills (`modules/*/skills/*/SKILL.md`) — 37 entries

All implicit-eligible: these are stack reference/guidance packages (language
and framework "notes," lint/type-check strategy, test strategy) loaded to
inform in-scope implementation or review. None can setup, install, commit,
release, or write externally. This includes `dhpk-matrix-cell-onboard` (a guided
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

### implicit-eligible (31, incl. `dhpk-matrix-cell-onboard` inherited)

`check-coverage`, `check-skill`, `codex-review-branch`, `codex-review-doc`,
`codex-review-fast`, `codex-review`, `codex-security`, `codex-test-gen`,
`codex-test-review`, `create-dev`, `deep-analyze`, `dep-audit`, `doc-refactor`,
`git-worktree`, `harness-audit`, `instinct-export`, `instinct-status`,
`dhpk-matrix-cell-onboard`, `merge-prep`, `pr-summary`, `precommit-fast`,
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

Skills: `dhpk-agy-commit`, `dhpk-claude-health`, `dhpk-continuous-learning-v2`,
`dhpk-create-skill`, `dhpk-git-smart-commit`, `dhpk-harness-revise`, `dhpk-cross-agent-sync`,
`dhpk-onepassword-session`, `dhpk-opsx-apply-goal`, `dhpk-project-setup`, `dhpk-release-creator`,
`dhpk-rules-distill`.

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
content unchanged: `dhpk-agy-commit`, `dhpk-claude-health`, `dhpk-continuous-learning-v2`,
`dhpk-create-skill`, `dhpk-git-smart-commit`, `dhpk-harness-fill`, `dhpk-harness-revise`,
`dhpk-cross-agent-sync`, `dhpk-onepassword-session`, `dhpk-opsx-apply-goal`, `dhpk-project-setup`,
`dhpk-release-creator`, `dhpk-repo-intake`, `dhpk-rules-distill`. Two implicit-eligible
skills were missing a routing cue outright and got one added:
`dhpk-codex-bridge` (no `Use when` trigger, no `Output:` cue) and
`dhpk-feature-verify` (no `Output:` cue). `tests/description-invocation-cues.test.js`
enforces both directions going forward — implicit-eligible retains all
three cues, explicit-only drops the `Use when` trigger.
