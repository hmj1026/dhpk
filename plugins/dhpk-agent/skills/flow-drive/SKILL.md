---
name: flow-drive
description: "Explicit-only implementation workflow for one task resolved by the Host into a bounded goal, acceptance contract, and constraints. Not for route selection, standalone review, formal OpenSpec authoring, or release. Diagnosis within a confirmed outcome gates dependent writes. Output: distinct execution and acceptance evidence, or an explicit blocker."
metadata:
  dhpk-invocation-class: "explicit-only"
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
`$flow-drive` invocations follow the advanced legacy Host procedure below.
These are separate interfaces; their `--cross-provider` semantics differ.

## User-facing Host procedure (advanced legacy path)

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
   eligible items continue. Use the portable recovery contract for configured
   attempt budgets and lifecycle proof. In the legacy advanced procedure, a
   rejected or modified item may be retried at most twice with its failure and
   current diff supplied as context.

Completion means every ordered item has implementation and verification
evidence, or the report names the exact blocker, skipped check, and resume
action.

## Implementation options

- `--plan[=<model>:<effort>]` explicitly requests a pre-implementation planner
  consult on supported implementation-class routes.
- `--plan-mode=auto|bounded|discovery` selects that consult's scope. It
  requires `--plan`, is independent of option order, and does not change the
  planner's work mode or model/effort. An enabled plan with no mode defaults to
  `auto`; a disabled plan has mode `null`. The parser checks grammar only.
  Flow Drive applies the scope-selection policy in
  [`execution-policy.md`](references/execution-bundle/rules/execution-policy.md#planner-consult-scope),
  reports its selection and evidence, and preserves the required authority and
  specialist gates.
- `--worker=<claude|codex|agy|auto>` selects the Worker Selector and preserves
  the existing worker-routing enum.
- `--worker-target=<provider>/<model>[:<effort>]` selects an explicit
  Provider/Model/Effort Execution Target. It is distinct from `--worker` and
  is not an alias for the selector.
- `--cross-provider` enables additional automatic candidates within current
  Host policy and access; it grants no additional authority. An explicit
  `--worker-target` is limited to that Worker tuple.
- `--reasoner=<provider>[/<model>[:<effort>]]` requests a bounded second opinion
  with a Provider-scoped target; canonical Role remains `reasoner`.
- `--architect` or `--no-architect` controls the architecture pass.
- `--codex` is a retired diagnostic and produces a blocking report; it never
  grants a peer, backend, or execution shortcut.

These options refine confirmed implementation work; they do not change its
owner or completion contract.

Host support: on Claude Code, Codex workers and reasoners use the bundled CLI
launcher from the parent session. `--reasoner=codex` uses the resolved role
configuration; `--reasoner=codex/gpt-6.1-sol:high` overrides model and effort.
`codex-cli` is a compatibility spelling. Parser readiness establishes valid
syntax; launch still checks current access, supported model/effort, and scope.
AGY workers and AGY worker targets remain blocked on this Host until their
Flow Drive launch integration is delivered.
The `--plan` effort is not applied there either: the planner runs at its
configured effort and the parser reports that as a notice.

## Output

Report ordered work items and OpenSpec task state, changed files, tests and
static checks, retry state, unresolved risks, and next handoff. For a planner consult, include the
requested and selected scope, selection reason, overridden signals, read and
child budgets, observed actual use, and blockers. Mark unobserved actuals as
`null` with `NOT_RUN` or `UNAVAILABLE`; never present a maximum as observed use.
Mark missing evidence as `BLOCKED` or `NOT RUN`. Keep implementation,
verification, and archive as separate states.

## References

- `references/execution-bundle/rules/execution-policy.md` — selected local
  invocation, planning, dispatch, and handoff policy. Its bundle base is the
  real parent of that policy file's containing `rules` directory.
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
  self-contained runtime under `references/cli-dispatch/scripts/`.
- `skills/flow-guide/SKILL.md` — optional separately invoked route guidance;
  Flow Drive does not load it as a prerequisite.
- An optional consumer-project writing-for-agents guide may be supplied when the
  confirmed change edits agent-facing instructions. A missing optional input
  does not authorize an ambient parent lookup.
