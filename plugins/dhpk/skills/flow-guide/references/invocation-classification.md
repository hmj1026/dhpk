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

## Root skills (`skills/*/SKILL.md`)

The inventory is the source for the complete current list. The capability
families introduced by this change are classified by their maximum authority:

### explicit-only

| Skill | Rationale |
|---|---|
| `skill-forge` | Skill authoring and rules distillation can write distributed policy surfaces. |
| `flow-drive` | Route/implementation modes can start a broad execution workflow. |

### implicit-eligible

| Skill | Rationale |
|---|---|
| `skill-scope` | Health, judge, stocktake, and scout modes collect or evaluate evidence. |
| `flow-guide` | Help, route, rules, next, and close actions guide or verify without implementing. |
| `change-verdict` | Review modes are read-only verdicts. |
| `code-trace` | Trace modes explain or investigate an already-scoped request. |

GitNexus skills remain separately owned by their external package and are not
reclassified or merged by the capability-family change. All other root and
module entries retain the class recorded in the inventory. Consult the
inventory retirement ledger for former names and exact replacement modes.

Notes on close calls:
- An explicit-only family may still call implicit-eligible evidence or review
  capabilities; it must present, rather than invoke, a second explicit-only path.
- A read-only default does not lower a family's class when one mode can mutate
  the harness, policy, or external publication surface.

## Module skills (`modules/*/skills/*/SKILL.md`) — 37 entries

All implicit-eligible: these are stack reference/guidance packages (language
and framework "notes," lint/type-check strategy, test strategy) loaded to
inform in-scope implementation or review. None can setup, install, commit,
release, or write externally. This includes `dhpk-matrix-cell-onboard` (a guided
checklist for CI-matrix cells — no elevated tools, editing stays within the
already-authorized library-authoring request).

## Commands (`commands/*.md`) — 29 entries

Only `matrix-cell-onboard.md` names a canonical skill 1:1 (paired; inherits
`implicit-eligible` from its skill). The remaining 38 are unpaired and own
their class directly.

### explicit-only (13)

| Command | Rationale |
|---|---|
| `create-pr` | Creates a GitHub PR (`gh pr create`). |
| `create-release` | Cuts a release. |
| `check-coverage`, `codex-test-gen`, `precommit-fast` | Explicit-only compatibility adapters retain their metadata; do not infer a lower class from their forwarding target. |
| `flow-drive` | Top-level implementation router; can reach explicit-only implementation workflows — classified explicit-only because it starts broad execution. |
| `harness-govern` | Read-only by default, but `--fix` mutates the harness in bulk; class reflects maximum authority, not the default mode. |
| `install-hooks` | Installation. |
| `install-rules` | Installation (writes into a consumer project's `.claude/rules/`). |
| `install-scripts` | Installation. |
| `opsx-apply-resume` | Already explicit-only. Resumes/continues an unattended OpenSpec-apply session. |
| `setup` | Already explicit-only. Interactive plugin (re)configuration. |
| `smart-commit` | Executes `git commit` in batches. |

### implicit-eligible (16, incl. `dhpk-matrix-cell-onboard` inherited)

`check-skill`, `codex-review`, `deep-analyze`, `dep-audit`, `doc-refactor`,
`git-worktree`, `harness-audit`,
`dhpk-matrix-cell-onboard`, `merge-prep`, `pr-summary`, `precommit`,
`project-brief`, `review-pending`, `simplify`, `spec-mine`, `ui-ux-verify`,
`update-codemaps`, `update-docs`, `verify`.

## Family migration

The capability-family change retires predecessor identities through the
inventory-owned ledger. Runtime routing uses the family plus a mode, so a
description or command must not recreate a retired alias. Keep the six
GitNexus package skills outside this migration and resolve them through their
own package contract.

For a new family, check that its `agents/openai.yaml` policy agrees with the
maximum authority of every mode, that implicit descriptions retain all routing
cues, and that explicit-only packages do not advertise automatic discovery.
