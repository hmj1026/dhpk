---
description: 'Explicit harness governance front door with health, budget, fill, revise, and sync modes; each mode preserves its own evidence and mutation boundary.'
argument-hint: '<health|budget|fill|revise|sync> [options]'
allowed-tools: 'Read, Grep, Glob, Bash, Skill'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# `/dhpk:harness-govern`

Use this command as the single explicit entry point for harness governance.
Select exactly one mode and pass its options through to the canonical
`skills/harness-govern/SKILL.md` procedure. A missing or ambiguous mode is
`BLOCKED`; do not infer a mode or run every mode.

## Usage

```text
/dhpk:harness-govern <health|budget|fill|revise|sync> [options]
```

| Mode | Use for | Boundary |
| --- | --- | --- |
| `health` | Diagnose harness configuration and hygiene | Read-only unless the mode explicitly receives its approved fix option |
| `budget` | Measure context cost and model-tier economics | Measurement only |
| `fill` | Propose or backfill missing harness layers | Preview first; apply only after approval |
| `revise` | Trim, deduplicate, and validate an existing harness | Dry-run first; apply only after approval |
| `sync` | Plan, apply, or validate cross-platform harness synchronization | Plan and dry-run are read-only; external targets require approval |

## Contract

1. Resolve the target harness directory. An explicit `--dir` wins; ambiguous
   discovery is `BLOCKED`.
2. Record the selected mode, target, action, dry-run state, changed paths,
   commands, timestamps, and exit codes. Preserve unrelated dirty work.
3. Load only the selected mode procedure and its named references. Keep the
   other mode procedures undisclosed until a new mode is explicitly selected.
4. Keep planned, applied, manual, failed, skipped, unavailable, and
   not-configured states distinct. Do not claim a write, parity, release, or
   external result without its own evidence.
5. End with one terminal status (`PASS`, `FAIL`, `BLOCKED`, `NOT_CONFIGURED`,
   or `NOT_RUN`) and exactly one next action. `NOT_RUN` is not `PASS`.

## Mode-specific handoff

- `health`: report the selected hygiene/configuration checks and any safe fix
  commands that still require operator approval.
- `budget`: report the detected model/window, observed component counts,
  estimates versus observations, and ranked savings.
- `fill`: report the inventory, gaps, selected layers, proposed or written
  files, and post-write verification.
- `revise`: report the baseline, G1–G13 findings, per-fix checks, post-fix
  checks, and deferred items.
- `sync`: report preflight, mapping plan, dry-run/apply state, per-platform
  validation, and any external target that was not configured.

## Related owners

- `skills/harness-govern/SKILL.md` — mode contracts and progressive-disclosure
  references.
- `rules/execution-policy.md` — dispatch, reviewer, and dirty-worktree rules.
- `$flow-guide help harness-govern` — Codex usage, options, and invocation
  class.

Do not recreate mode-specific checks in this command. Use the canonical skill
and its selected references so each mode retains the capability and evidence
of its predecessor without exposing retired entry points.
