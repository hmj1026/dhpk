---
name: flow-drive
argument-hint: '<task-text|task-file|confirmed-spec-or-change-id> [--worker=auto|provider[/model[:effort]]] [--reasoner=provider[/model[:effort]]] [--cross] [--plan[=auto|bounded|discovery]] [--architect|--no-architect]'
description: 'Explicit-only implementation workflow for one task resolved by the Host into a bounded goal, acceptance contract, and constraints. Not for route selection, standalone review, formal OpenSpec authoring, or release. Diagnosis within a confirmed outcome gates dependent writes. Output: distinct execution and acceptance evidence, or an explicit blocker.'
disable-model-invocation: true
metadata:
  dhpk-capability-id: dhpk.skill.flow-drive
  dhpk-name-style: portable-family
  dhpk-invocation-class: explicit-only
  dhpk-next:
    PASS: repo-verify
    FAIL: none
    BLOCKED: none
    NOT_RUN: none
    UNAVAILABLE: none
---

# Flow Drive

Use `$flow-drive <task-text|task-file|confirmed-spec-or-change-id> [options]`
for one bounded implementation task. The Host resolves that single positional
input into a goal, acceptance criteria, and structured constraints before
dispatch. Pass the input as one positional argument; quote multiword task
text or a path containing spaces, for example
`$flow-drive "Fix checkout flow and verify receipt totals" --worker=codex`.
Preserve that argument boundary when invoking the parser. When ownership is unclear, return an explicit blocker or use the
separately invoked route owner; use the external OpenSpec authoring owner when
a proposal or artifact is still missing. Flow Drive consumes the shared neutral
handoff contract and does not load a peer skill to validate its input.

## When NOT to Use

- The route, target, or acceptance contract is unclear: return a blocker with
  the missing evidence; do not infer a route or load a peer skill. A separately
  invoked `flow-guide route` may provide a handoff, but Flow Drive never calls
  it as a prerequisite.
- A proposal or OpenSpec artifact still needs authoring: use external `$openspec-propose`.
- The task is review-only or diagnostic-only: use `change-verdict` or `code-trace`.
- The requested outcome is a standalone commit, release, deployment, or
  archive action. Flow Drive implements confirmed changes but does not perform
  those actions.

## Boundary

Flow Drive owns implementation of the confirmed work, including evidence
collection and diagnosis when the outcome is settled but a cause is unknown.
Only dependent writes wait for sufficient cause, repair, and verification
evidence; independent work continues. A manual proposal may be written inside
an explicitly assigned scratch scope. External OpenSpec proposal/artifact
authoring remains with its separate owner. It does not choose a
route, author formal OpenSpec artifacts, review an existing diff, or claim archive, commit,
merge, release, deployment, or pilot evidence. Its explicit-only boundary is
preserved even when a caller presents a ready-looking route.

## Programmatic runner API

Code that embeds or invokes the exported `runFlowDrive(...)` API uses the
[portable runner reference](references/portable-runner.md). User-facing
`$flow-drive` invocations follow the Host procedure below. Both interfaces use
the same grammar and keep selection intent separate from Host grants.

## User-facing Host procedure

0. Before anything else, run the parser as one shell command, exactly
   `cd <this Skill directory> && node scripts/invocation.js <identifier> [options] && cd <project root>`,
   with the identifier and options supplied, verbatim. `<project root>` is the
   working directory the session started in. Read the exit status and the
   parser's JSON from the tool result; add nothing else to the command (no
   `echo`, redirect, or extra step). If the command is denied, report step 0
   as `BLOCKED` with the denial and stop; do not retry it in another form.
   Exit `2` (`status: blocked`) stops the run with its `diagnostics` before
   any dispatch. The return `cd` does not run on a non-zero exit, so begin any
   later command in this session with `cd <project root>`. Carry every
   `notices` entry into the report.
1. Read the confirmed task text/file and any applicable specification or change artifacts in order. Resolve
   repository instructions, context, target files, nearby tests, and the
   verification commands before editing. When the Host has dedicated
   file-reading and search tools (on Claude Code: Read, Grep, Glob), use them
   for this discovery, and run shell commands only for the step 0 parser, the
   verification commands resolved here, the diff inspection in step 3, and the
   selected CLI dispatch, bounded availability checks, and scoped input/artifact
   preparation commands documented in `references/parent-cli-dispatch.md`, or a
   command the current grant lists. On a Host without such tools, use its
   read-only shell access for discovery.
2. Convert the work into dependency-ordered observable items. Preserve
   OpenSpec task order and leave incomplete tasks unchecked. Reuse sufficient
   plan and handoff evidence; consult the planner only when an unresolved
   decision, dependency, ownership boundary, cross-owner sequence, or material
   risk leaves a required planning outcome missing. The number of unchecked
   tasks alone does not trigger a planner. Preserve an accepted explicit
   `--plan` request under the existing parser and capability rules.
3. At each behavior boundary, run the smallest non-tautological test first,
   make the smallest compatible edit, inspect the diff, and run the focused
   verification. Preserve unrelated dirty work.
4. Keep planner, worker, reasoner, and architecture choices within the
   implementation policy. Optional backends are explicit and cannot silently
   replace the current implementer.
   On Claude Code, launch selected Codex roles from the parent session through
   `scripts/launch-dispatch.js`; follow `references/parent-cli-dispatch.md` for the
   dispatcher packet, reasoner-before-worker gate, and independent verification.
5. Stop the affected item on an evidence-changing blocker while independent
   eligible items continue. This Host procedure sets no generic retry count.
   The programmatic runner executes one attempt by default; only a Host that
   embeds `runFlowDrive(..., { recovery })` opts into the bounded [runner
   recovery contract](references/recovery.md) and its shared retry budget and
   lifecycle proof.

Completion means every ordered item has implementation and verification
evidence, or the report names the exact blocker, skipped check, and resume
action.

## Implementation options

- `--worker=auto|provider[/model[:effort]]` selects native automatic candidates
  by default, one Provider, or an exact Worker target. Providers are
  `claude`, `codex`, and `agy`; model and effort stay literal.
- `--reasoner=provider[/model[:effort]]` selects a separate read-only reasoner.
  Dependent writers require its verified `READY_FOR_DISPATCH` conclusion.
- `--cross` expands automatic candidates for this invocation only. Explicit
  Provider intent needs no redundant flag, but still requires a current Host
  grant for the selected role/target/authority before external probe or launch.
  Legacy cross-provider environment/configuration cannot broaden Flow Drive.
- `--plan[=auto|bounded|discovery]` selects consult scope; bare `--plan`
  equals `--plan=auto`. The current Host supplies its effective declared
  planner target/default; missing or invalid support blocks clearly.
  The portable runner consumes that profile and has no separate adapter for
  legacy `planner_target` or Claude planner settings.
- `--architect` requests consultation. The current portable Host contract
  reports `UNAVAILABLE` because it declares no architecture route/receipt.
  Omission preserves Host policy; `--no-architect` suppresses an optional
  consultation while preserving required design gates.
- Removed `--worker-target`, `--cross-provider`, `--plan-mode`,
  `--plan=model:effort`, and provider aliases reject before dispatch.
  `--codex` remains a blocking retirement diagnostic.

On Claude Code, Codex workers and reasoners use the parent-session CLI launcher
and a current exact Host grant. AGY dispatch remains unsupported on that Host.
Parser readiness proves grammar only; capability, grant, observed target,
receipt, and independent acceptance remain separate.

## Output

Report ordered work items and OpenSpec task state, changed files, tests and
static checks, retry state, unresolved risks, and next handoff. For a planner consult, include the
requested and selected scope, selection reason, overridden signals, read and
child budgets, observed actual use, and blockers. Mark unobserved actuals as
`null` with `NOT_RUN` or `UNAVAILABLE`; never present a maximum as observed use.
Mark missing evidence as `BLOCKED` or `NOT RUN`. Keep implementation,
verification, and archive as separate states.

## References

- `references/execution-bundle/rules/execution-policy-kernel.md` — Read before
  any detailed execution-policy section; its invariants govern the whole Host
  procedure.
- `references/execution-bundle/rules/execution-policy.md` — Read §Planning and
  workflow composition when step 2 has an unresolved planning need; read
  §Agent dispatch and §Implementation dispatch when role, dispatch, or handoff
  decisions need detail beyond steps 4–5. Its bundle base is the real parent
  of that policy file's containing `rules` directory.
- `references/execution-bundle/scripts/lib/flow-handoff-contract.js` — shared
  neutral route handoff and evidence boundary; it does not grant execution
  authority.
- `references/execution-bundle/` — synchronized local copy of the policy,
  contract, catalog, and dispatch files this Skill's scripts and policy depend
  on. dhpk maintainers regenerate it with the repository's skill-resource
  synchronizer; it is not a consumer step, so never edit it here.
- `scripts/invocation.js` — local invocation parsing; `scripts/dispatch.js` —
  dispatch-target resolution over the bundled contracts. Flow Drive has no
  mandatory peer Skill dependency.
- `references/parent-cli-dispatch.md` — Claude Code parent-session Codex launch;
  `scripts/launch-dispatch.js` consumes its explicit dispatcher packet and the
  self-contained runtime under `scripts/dispatch-runtime/`, `scripts/adapters/`, and
  `scripts/transport/`.
- `skills/flow-guide/SKILL.md` — optional separately invoked route guidance;
  Flow Drive does not load it as a prerequisite.
- An optional consumer-project writing-for-agents guide may be supplied when the
  confirmed change edits agent-facing instructions. A missing optional input
  does not authorize an ambient parent lookup.
