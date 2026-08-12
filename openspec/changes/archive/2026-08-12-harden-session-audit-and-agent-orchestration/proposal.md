## Why

The v0.37.0 audit shows that the role model map is largely valid, but the evidence pipeline and orchestration contracts can report success without proving the underlying symptom, omit active Orca session sources, or close review gates without a fresh artifact. At the same time, handoff documents, Codex projections, and always-visible metadata duplicate or contradict policy, increasing token cost and making the main orchestrator carry work that should be deterministic.

This change consolidates the confirmed findings into one evidence-and-orchestration hardening effort before any issue filing or implementation begins.

## What Changes

- Make session-audit findings typed and source-complete: distinguish runtime failures from prompts, memory, historical summaries, and successful hook records; discover active Orca `CODEX_HOME`; expose coverage, malformed, and unsupported-source states separately.
- Bind verification to each finding's observable symptom and expected assertion; prevent generic command success from producing a verified defect; normalize agent identity counts separately from installation rows.
- Repair opsx resume/handoff references and remove the false commit-first/worktree-loss semantics; treat commit, memory, precommit, and provider capabilities as explicit optional gates.
- Make reviewer completion evidence-based: a fresh artifact, matching scope/diff, and verdict are required; failed starts, quota blocks, retries, and producer/consumer readiness are explicit lifecycle states with bounded retry.
- Harden Codex role projection and validation: resolve every referenced target, validate metadata enums and names, reject stale generated roles, remove unavailable handoffs, and keep generic roles stack-neutral.
- Reduce context overhead by separating always-visible safety and routing contracts from conditional references, bounding discovery descriptions, and assigning one SSOT to routing/policy mechanics.
- Preserve existing dirty-worktree, single-writer, review-trigger, security, and `NOT RUN`/`BLOCKED` safeguards.

## Capabilities

### New Capabilities
- `session-audit-integrity`: typed session records, complete source discovery, symptom-bound verification, and truthful audit coverage/count reporting.
- `orchestration-evidence-lifecycle`: producer/consumer readiness, quota/retry states, and artifact-backed completion across handoff and review workflows.

### Modified Capabilities
- `harness-reference-integrity`: resolve natural-language skill/command handoffs, including canonical opsx skill names.
- `reviewer-liveness-gate`: require fresh artifact-backed closure and preserve pending state for missing or stale evidence.
- `reviewer-wave-economy`: bind retries and re-reviews to scope/diff changes and record attempts versus completed verdicts.
- `codex-agent-role-parity`: validate role names, models, efforts, sandboxes, targets, supporting handoffs, module agents, and stale generated files.
- `distribution-surface-governance`: make optional discovery boundaries and metadata budgets observable rather than implicit.
- `rules-ssot-dedup`: assign deterministic routing/handoff ownership and remove contradictory duplicate policy prose.

## Impact

- Audit implementation and tests under `skills/dhpk-session-usage-audit/` and `tests/`.
- Opsx command/skill handoff documents under `commands/opsx-apply-resume.md`, related references, and reference-integrity validators.
- Reviewer hooks/contracts, review artifacts, and orchestration telemetry under `.codex/`, `scripts/hooks/`, and workflow policy files.
- Codex generators, role maps, supporting trap sheets, validators, and generated role projections.
- Claude/Codex discovery manifests, skill and agent descriptions, `commands/do.md`, and execution-policy references.
- No GitHub issue creation, release, commit, or unrelated worktree cleanup is included.
