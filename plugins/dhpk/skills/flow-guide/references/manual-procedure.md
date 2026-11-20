# Flow Guide — Manual Procedure

Use this fallback when the package-local `scripts/` helpers (`action-runner.js`,
`pre-route.sh`, `usage-card.js`) are absent (such as in the instruction-only
Directory Plugin) or cannot execute.

## Safety Rules

- Advisory only: record evidence and hand work to a single explicit target; never
  execute the routed target skill or inherit its write authority.
- Load only references required by the single chosen action; listing a reference
  does not load it.
- Keep `PASS`, `FAIL`, `BLOCKED`, `SKIPPED`, `UNAVAILABLE`, and `NOT_RUN`
  distinct. Any stage or check that did not execute MUST be reported as
  `NOT_RUN` and MUST NEVER yield an overall `PASS`.
- Every report produced by following this document MUST state `mode: manual`.

## Stage: help

1. Read [codex-usage-catalog.json](codex-usage-catalog.json) with `Read`.
2. Without a target skill name, summarize `runtimeIndex.targets` / `entries`
   usage syntax only — do not load any target `SKILL.md`.
3. With one target skill name, look up the matching entry in
   `codex-usage-catalog.json` (distinguishing unknown vs known non-Codex names)
   and render its usage card cleanly, marking `mode: manual`.

## Stage: pre-route

1. Treat an empty query as `NO_QUERY`.
2. Read [route-table.json](route-table.json) with `Read`.
3. Evaluate `rules[]` in array order against `<query>` as case-insensitive
   regular expressions. Stop at the first match and record `target.id`,
   `target.kind`, `label`, and optional `skillAction`; if none matches, record
   `NO_MATCH` for deliberate classification.

## Stage: route

1. Perform `## Stage: pre-route` first when classifying free-text input.
2. Read the policy kernel
   [execution-policy-kernel.md](execution-bundle/rules/execution-policy-kernel.md)
   first, then only conditional sections needed by the matched route.
3. Validate the emitted `dhpk.route-result.v3` fields against
   [route-result.schema.json](route-result.schema.json) (`schema`, `action`,
   `host`, `cleanedQuery`, `options`, `target`, `availability`, `diagnostics`,
   `disposition`, `requiredEvidence`, `nextAction`).
4. Respect invocation class: without `--go`, return `disposition: advice`; with
   `--go`, emit a handoff only for an `implicit-eligible` target and report
   `explicit-required` for explicit-only skills. Include `mode: manual` in the
   accompanying report.

## Stage: rules

1. Read [execution-policy-kernel.md](execution-bundle/rules/execution-policy-kernel.md)
   first.
2. Load only the conditional sections of
   [execution-policy.md](execution-bundle/rules/execution-policy.md) or
   [invocation-precedence.md](execution-bundle/skills/flow-guide/references/invocation-precedence.md)
   that answer the exact policy question.
3. Return the source pointer, applicable gates, `status: manual-evidence-required`,
   `mode: manual`, and one next handoff without treating a lookup as a gate
   pass.

## Stage: next

1. Inspect the consumer repository using read-only Git commands (`git rev-parse --abbrev-ref HEAD`,
   `git rev-parse --short HEAD`, `git status --porcelain=v1`).
2. Read `skill-next-map.json` (located at the Directory Plugin package root if
   packaged without `scripts/`) or [progression-tables.md](progression-tables.md)
   to map prior skill outcomes to candidate next skills.
3. Verify any claimed prior `passed` record against the current `HEAD` and live
   diff identity; treat unbound, stale, or diff-mismatched records as not
   current (`NOT_RUN` / stale, never overall `PASS`). Report `mode: manual`.

## Stage: close

1. Account for all changed files, required TDD evidence when behavior changed,
   applicable reviewer slots, triggered security/database/frontend/runtime
   checks, and unresolved risks using
   [handoff-and-verification.md](handoff-and-verification.md) only if needed.
2. Report each check with its observed state (`PASS`, `FAIL`, `NOT_RUN`, or
   `UNAVAILABLE`) alongside `mode: manual`.
3. Do not declare an overall `PASS` or commit/merge/release readiness if any
   required stage or check is `NOT_RUN` or `FAIL`.
