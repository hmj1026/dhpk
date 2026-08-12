## Why

The Codex projection currently exposes only a curated subset of the canonical
agent roster, while several useful roles have no explicit Codex coverage or
documented fallback. Its model settings also mix high-cost models, maximum
effort defaults, and an older GPT-5.5 monitor without one current Codex-specific
policy. This change aligns role coverage and model/effort choices before more
consumer projects inherit the projection.

## What Changes

- Add Codex projections for `planner`, `spec-miner`, `frontend-reviewer`,
  `migration-reviewer`, and `e2e-runner`.
- Record an explicit coverage classification for every canonical agent:
  direct role, merged role, skill/manual fallback, capability-gated, or
  intentionally unavailable.
- Keep `e2e-runner` write-capable and require a fail-loud fallback when the
  consumer cannot provide its Playwright/browser capability.
- Rebalance Codex model and effort metadata while preserving the requested
  quality-first `gpt-5.6-luna` + `max` settings for `worker` and `tdd-guide`.
- Change the global default effort to `medium`, remove the active GPT-5.5
  monitor dependency, and document the accepted cost/quality trade-offs.
- Extend generator, runtime validation, documentation, and consumer tests for
  the new role set and metadata contracts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-agent-role-parity`: expand the direct-role allowlist and require a
  complete canonical-role coverage matrix, including the `e2e-runner`
  capability boundary.
- `model-economics`: add the Codex projection tier map, current model/effort
  defaults, and the explicit `worker`/`tdd-guide` maximum-effort exception.

## Impact

- Codex role projection: `codex/agents/`, `scripts/gen-codex-agents.js`, and
  `codex/AGENTS.md` / README documentation.
- Runtime and generator contract tests under `tests/` and Codex validation
  helpers under `scripts/ci/`.
- Consumer installation and clean-projection checks for the expanded role set.
- No public application API or production data changes. Existing unrelated
  working-tree changes remain untouched.
