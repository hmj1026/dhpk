# Host capability and resource boundary

Read before Phase 3 or any later Host write, and before installing an asset group.

## Host capability

This Skill's detection, confirmation, rendering, and final report are an
instruction-driven Claude Host procedure. They do not expose a detection or
render executable and do not claim Cursor or Codex runtime support. A fixture
or static instruction check leaves actual Host evidence `NOT_RUN`.

Before Phase 3 or any later Host write, verify that Claude can `Read` and
`Glob` the project, call `AskUserQuestion`, and use project `Edit`/`Write`.
If a required capability is absent, stop before mutation and report
`BLOCKED` or `UNAVAILABLE` with the literal reason
`HOST_CAPABILITY_UNAVAILABLE: <capability>`.

## Source artifact

For asset groups, require an explicit `--source-artifact <distribution-root>`
unless the selected mode is `--lite`, `--detect-only`, or `--env-only`. The
Skill-local `scripts/install-project-assets.sh` executes only its adjacent
writer and reads selected artifact files as data. It never resolves a parent
checkout, sibling Skill, or installer under the artifact.
