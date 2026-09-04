---
name: harness-govern
description: "Govern a project harness through one explicit health, budget, fill, revise, or cross-platform sync mode for structure, context cost, missing infrastructure, safe trimming, or Claude-first parity. Not for application code or ordinary skill authoring. Output: mode-specific evidence, dry-run or applied-change state, and a terminal gate."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Harness Govern

Use only after the user explicitly invokes `$harness-govern`. Select exactly one
mode; the mode is the work boundary. A missing or ambiguous mode is a
`BLOCKED` result, not a reason to run every audit.

## When NOT to Use

- Application code, product behavior, or ordinary repository implementation is the target.
- A new skill or rule is being authored: use `skill-forge`.
- More than one governance mode is implied but none was explicitly selected.
- External synchronization or mutation lacks the mode-specific approval boundary.

## Mode selection

| Mode | Select when | Load only this mode's procedure |
| --- | --- | --- |
| `health` | Claude configuration, plugin version, hook wiring, or harness hygiene needs a diagnostic | `references/health-workflow.md` |
| `budget` | Context-window cost, component overlap, or model-tier economics needs measurement | `references/budget-workflow.md` |
| `fill` | A new or incomplete project needs missing harness layers proposed or backfilled | `references/fill-workflow.md` |
| `revise` | An existing `.claude/` or `.codex/` harness needs safe trimming and regression checks | `references/revise-workflow.md` |
| `sync` | Claude-owned harness capabilities need a reviewed Codex, AGY, Antigravity, or Cursor plan/sync | `references/sync-workflow.md` |

These are the only modes. Do not infer an unlisted action or selector as
another mode.

## Shared preflight

1. Resolve the active harness with
   `references/harness-directory-contract.md`. An explicit `--dir` wins; a
   caller hint wins next; ambiguous discovery is `BLOCKED`.
2. State the selected mode, target directory, requested action, and whether the
   run is `--dry-run`. Preserve unrelated dirty work and record paths, commands,
   timestamps, and exit codes for deterministic checks.
3. Read only the selected mode procedure and its named references. Keep sibling
   procedures undisclosed unless the user starts a new mode.
4. Treat report/plan as the default. A write-capable mode may mutate only after
   its own approval boundary and a visible dry-run or equivalent preview.
   Never hide a failed, unavailable, skipped, or not-configured check.

## Mode contracts

| Mode | Dry-run / mutation boundary | Required output | Done means |
| --- | --- | --- | --- |
| `health` | Diagnostic by default; `--fix-safe` or `--fix` delegates approved fixes; `--dry-run` suppresses delegation | C1-C7 and/or S1-S3 status, P1/P2 issues, targeted fix commands | Every selected check has a status and the gate names all remaining issues |
| `budget` | Measurement only; `--dry-run` is accepted as an explicit no-write declaration | Detected model/window, observed component counts, estimates, ranked savings, tier verdict | All buckets are accounted for and assumptions are separate from observations |
| `fill` | `--dry-run` previews files and layers; apply requires approval | Inventory, gaps, selected layers, changed-file list, line counts, commit-message draft | Every proposed layer is accepted, skipped with reason, or written and verified |
| `revise` | `--dry-run` reports the gap plan; project hook execution additionally requires separately approved `--execute-hooks`; apply follows approval and per-fix checks | Active harness, baseline, G1-G13 findings, fixes, post-fix checks, deferred items | Baseline and post-fix deterministic checks are evidenced, or a pre-existing failure is reported |
| `sync` | `plan` and `apply --dry-run` are read-only; live apply requires explicit approval plus the exact reviewed `--approved-plan-sha256` | Preflight, mapping plan, plan digest, dry-run/apply report, per-platform validation gate | Self-test, approved scope/digest, and each applicable platform state are recorded |

Every mode ends with one of `PASS`, `FAIL`, `BLOCKED`, `NOT_CONFIGURED`, or
`NOT_RUN`, plus one next action. `NOT_RUN` is not `PASS`. A report never claims
commit, merge, release, deployment, publication, or external parity without
the corresponding independent evidence.

## Output shape

```text
Mode → Target → Action / dry-run state → Evidence → Findings → Gate → Next action
```

For a write-capable run, also list `planned`, `applied`, `manual`, and `failed`
items separately. For a blocked run, state `blocker / attempted / next step`.
Redact secrets and local credentials from captured output.

## References and scripts

Load references only for the selected mode:

- `health`: `health-workflow.md`, `hygiene-checks.md`, `plugin-sync.md`,
  `usage-examples.md`, and `best-practices.md`.
- `budget`: `budget-workflow.md`.
- `fill`: `fill-workflow.md` and `frontmatter-templates.md`.
- `revise`: `revise-workflow.md`, `harness-directory-contract.md`, and
  `scripts/harness-inventory.sh`, `scripts/harness-scenarios.sh`, and
  `scripts/test-harness.sh`.
- `sync`: `sync-workflow.md`, `capability-sources.md`,
  `execution-contract.md`, `platform-mapping.md`, `risk-policy.md`,
  `runtime-entrypoints.md`, `source-conflicts.json`, and
  `scripts/multi_ai_sync.py`. Read `improvement-todo.md` only when the current
  sync report identifies one of its deferred gaps.

The copied deterministic scripts are the mode's executable source of truth;
do not retype their checks in a report or silently replace them with a weaker
one-off command.

## Verification

- [ ] Exactly one of `health|budget|fill|revise|sync` was selected.
- [ ] Harness resolution and mode-specific references were recorded.
- [ ] Dry-run, approval, applied, manual, failed, skipped, and unavailable
      states are distinct where the mode supports them.
- [ ] The selected mode's output and completion contract is satisfied.
- [ ] Unresolved risk has one next action and no unsupported release claim.
