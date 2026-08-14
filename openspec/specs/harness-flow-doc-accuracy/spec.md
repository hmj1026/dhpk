# harness-flow-doc-accuracy Specification

## Purpose
TBD - created by archiving change script-test-backfill-and-harness-fixes. Update Purpose after archive.
## Requirements
### Requirement: README hook-chain descriptions match the wired hooks

Shipped docs that describe the hook chain per lifecycle event — `README.md`, `README.zh-TW.md`, and `docs/hook-extension.md` — SHALL name the hooks actually wired for that event in `hooks/hooks.json`. The Stop-event description SHALL list the hooks wired under the `Stop` key (including `stop-dispatch.sh`) and SHALL NOT list `reap-stale-sentinels.sh`, which runs at `SessionEnd` (via `session-end.sh`), not Stop.

#### Scenario: The Stop-chain description is corrected
- **WHEN** `README.md` / `README.zh-TW.md` describe the Stop chain as ending in `reap-stale-sentinels`
- **THEN** the description is corrected to name the actual 4th Stop hook (`stop-dispatch`), and `reap-stale-sentinels` is described under SessionEnd

#### Scenario: hook-extension doc no longer implies reap-stale is a standalone hooks.json entry
- **WHEN** `docs/hook-extension.md` groups `reap-stale-sentinels.sh` with the standalone `hooks.json` entries
- **THEN** it is corrected to reflect that reap-stale runs at SessionEnd (via `session-end.sh`), not as a `hooks.json` entry of its own

### Requirement: The adaptive-dev-workflow buckets round-trip to the execution-policy change-type SSOT

`skills/adaptive-dev-workflow/SKILL.md` presents three workflow buckets while `rules/execution-policy.md` defines six change types (the OpenSpec-ask SSOT). The skill SHALL carry an explicit mapping note stating how its three buckets map onto the six SSOT rows, so an agent classifying via the skill can round-trip to the OpenSpec-ask table. The skill SHALL NOT restate a divergent taxonomy without this bridge, and SHALL NOT rename the execution-policy anchor headings.

#### Scenario: The skill provides the bucket→SSOT mapping
- **WHEN** an agent reads `skills/adaptive-dev-workflow/SKILL.md` to classify a change
- **THEN** the skill states which of the six execution-policy change types each of its three buckets covers (including where "Bug Fix known root cause" and "Medium change" land)

#### Scenario: SSOT anchors are preserved
- **WHEN** the mapping note is added
- **THEN** no `rules/execution-policy.md` section anchor heading is renamed (no CI protects section pointers)
