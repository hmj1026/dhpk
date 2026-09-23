# Invocation classification decision table

The `skills/`, `modules/`, and `agents/` paths below describe target-project
inputs and classification evidence. They are not required resources of a raw
Skill bundle and must never trigger an upward checkout search.

SSOT for every Distributed Skill and Distributed Command's `explicit-only` /
`implicit-eligible` classification (`metadata.dhpk-invocation-class`). Reviewed
once per entry against maximum authority, not inferred from descriptions or
existing runtime flags. See `openspec/specs/skill-invocation-policy/spec.md`
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
release, or write externally. This includes `matrix-cell-onboard` (a guided
checklist for CI-matrix cells — no elevated tools, editing stays within the
already-authorized library-authoring request).

## Commands (`commands/*.md`) — 31 physical entries

The active command surface is exactly the 31 physical files below. Host-only
adapters remain physical command front doors and are not portable Skill aliases;
the two thin front doors retain their owning Skill contracts.

`check-coverage`, `codex-test-gen`, `create-pr`, `create-release`, `deep-analyze`,
`dep-audit`, `doc-refactor`, `flow-drive`, `flow-guide`, `git-worktree`,
`harness-audit`, `harness-govern`, `install-hooks`, `install-rules`,
`install-scripts`, `matrix-cell-onboard`, `merge-prep`, `opsx-apply-resume`,
`pr-summary`, `precommit`, `precommit-fast`, `project-brief`, `review-pending`,
`setup`, `simplify`, `smart-commit`, `spec-mine`, `ui-ux-verify`,
`update-codemaps`, `update-docs`, and `verify`.

The command disposition manifest records the authority, owner, callers, and
structural evidence for each physical entry. Former command aliases are kept
only in its separate removed ledger; they are not active discovery routes.

## Family migration

The capability-family change retires predecessor identities through the
inventory-owned ledger. Runtime routing uses the family plus a mode, so a
description or command must not recreate a retired alias. Keep the six
GitNexus package skills outside this migration and resolve them through their
own package contract. OpenSpec proposal authoring is owned by the external
`openspec-propose` workflow, and operator session setup remains an explicit
operator action.

For a new family, check that its `agents/openai.yaml` policy agrees with the
maximum authority of every mode, that implicit descriptions retain all routing
cues, and that explicit-only packages do not advertise automatic discovery.
