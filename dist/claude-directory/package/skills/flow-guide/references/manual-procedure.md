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
- Choose exactly one action: `help`, `route`, `rules`, `next`, or `close`. The
  first token is the action; after `/dhpk-lite:flow-guide` the next
  token is the action. No action, or an unknown action, is `BLOCKED`. A later
  action name is `BLOCKED` only when every other positional (non-`-`) token is
  also an action name; otherwise the remaining tokens are query text (`route fix
  the close handler` is valid). `--go` is valid only for `route`, at most once,
  and only as a standalone option; `--go=<value>` is rejected.
- For `route`, these options are retired and yield a blocked diagnostic:
  `--route-only`, `--execute-explicit`, `--openspec`, `--opsx`, `--mode`,
  `--mode=…`, `--plan`, `--plan=…`, `--worker=…`, `--reasoner=…`, `--architect`,
  `--no-architect`, and `--codex`. Remove them from the cleaned query.

## Stage: help

1. Read [codex-usage-catalog.json](codex-usage-catalog.json) with `Read`.
2. Without a target skill name, summarize `runtimeIndex.targets` / `entries`
   usage syntax only — do not load any target `SKILL.md`.
3. With one target skill name, look up the matching entry in
   `codex-usage-catalog.json` (distinguishing unknown vs known non-Codex names)
   and render its usage card cleanly, marking `mode: manual`.

## Stage: pre-route

1. Treat an empty or whitespace-only query as `NO_QUERY`.
2. Read [route-table.json](route-table.json) with `Read`. If it cannot be read
   or parsed, record `NO_MATCH`.
3. Evaluate `rules[]` in array order against `<query>` as case-insensitive
   regular expressions. Skip a rule that has no `pattern`, has no `target.id`,
   or whose regex does not compile. Stop at the first match and record
   `target.id`, `target.kind`, `label` (default `target.id`), and optional
   `skillAction`; if none matches, record `NO_MATCH` for deliberate
   classification.
4. If the matched target has a `skillAction`, it is valid only when
   `target.kind` is `skill` and the action is kebab-case
   (`[a-z0-9]+(-[a-z0-9]+)*`). Otherwise record `NO_MATCH`.

## Stage: route

1. Perform `## Stage: pre-route` first when classifying free-text input.
2. Read the policy kernel
   [execution-policy-kernel.md](execution-bundle/rules/execution-policy-kernel.md)
   first, then only conditional sections needed by the matched route.
3. Validate the emitted `dhpk.route-result.v3` fields against
   [route-result.schema.json](route-result.schema.json) (`schema`, `action`,
   `host`, `cleanedQuery`, `options`, `target`, `availability`, `diagnostics`,
   `disposition`, `requiredEvidence`, `nextAction`).
4. Respect invocation class and set `disposition` by taking the first rule that
   applies, in this order:
   1. `blocked`: a blocking diagnostic. Only retired or unsupported option
      diagnostics block; a "no route matched" diagnostic does not.
   2. `advice`: no `--go` (even when availability is `not-configured` or there is
      no target).
   3. `blocked`: `--go` with no target.
   4. `explicit-required`: the target is `explicit-only`.
   5. `unavailable`: availability is `unavailable`.
   6. `blocked`: availability is `not-configured`.
   7. `blocked`: the target is not `implicit-eligible`.
   8. `ready`: otherwise (available, `implicit-eligible`).

   An invalid or unknown `skillAction` on the matched target gives `unavailable`
   with a null target, even without `--go` (unless a blocking diagnostic applies
   first, which gives `blocked`).
   Include `mode: manual` in the accompanying report.

## Stage: rules

1. Read [execution-policy-kernel.md](execution-bundle/rules/execution-policy-kernel.md)
   first.
2. The reference set is `execution-policy.md` and `invocation-precedence.md`.
   Load only the conditional sections of
   [execution-policy.md](execution-bundle/rules/execution-policy.md) or
   [invocation-precedence.md](execution-bundle/skills/flow-guide/references/invocation-precedence.md)
   that answer the exact policy question.
3. Return the source pointer, applicable gates, `status: manual-evidence-required`,
   `mode: manual`, and one next handoff without treating a lookup as a gate
   pass.

## Stage: next

`next` is best-effort in manual mode. The script `analyze.js` inspects more
than these steps: git diff, status, and branch, review state and precommit
flags, test gaps, security and migration hotspots, README and locale drift,
and request, backlog, and feature completion. The report MUST say `best-effort`.

1. Inspect the consumer repository using read-only Git commands (`git rev-parse --abbrev-ref HEAD`,
   `git rev-parse --short HEAD`, `git status --porcelain=v1`).
2. Read `skill-next-map.json` in this skill if present, else the
   package-root `skill-next-map.json`, else treat it as no next-map routes (as
   the script does with an absent file). Or read
   [progression-tables.md](progression-tables.md). Use the map to map prior skill
   outcomes to candidate next skills.
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
