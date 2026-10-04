---
name: flow-drive
description: "Explicit-only implementation workflow for a confirmed specification or OpenSpec change whose target and acceptance contract are settled. Not for route selection, proposal authoring, review, debugging without a confirmed cause, or release. Output: ordered implementation and verification evidence, or an explicit blocker."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Flow Drive

Use `$flow-drive <confirmed-spec-or-change-id> [implementation-options]` only
after the specification, target, and acceptance boundary are confirmed. When
ownership is unclear, return an explicit blocker or use the separately invoked
route owner; use the external OpenSpec authoring owner when a proposal or
artifact is still missing. Flow Drive consumes the shared neutral handoff
contract and does not load a peer skill to validate its input.

## When NOT to Use

- The route, target, or acceptance contract is unclear: return a blocker with
  the missing evidence; do not infer a route or load a peer skill. A separately
  invoked `flow-guide route` may provide a handoff, but Flow Drive never calls
  it as a prerequisite.
- A proposal or OpenSpec artifact still needs authoring: use external `$openspec-propose`.
- The task is review-only or diagnostic-only: use `change-verdict` or `code-trace`.
- Commit, release, deployment, or archive authority has not been separately granted.

## Boundary

Flow Drive owns implementation of the confirmed work. It does not choose a
route, author a proposal, review an existing diff, or claim archive, commit,
merge, release, deployment, or pilot evidence. Its explicit-only boundary is
preserved even when a caller presents a ready-looking route.

## Implementation contract

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
1. Read the confirmed specification or change artifacts in order. Resolve
   repository instructions, context, target files, nearby tests, and the
   verification commands before editing. When the Host has dedicated
   file-reading and search tools (on Claude Code: Read, Grep, Glob), use them
   for this discovery, and run shell commands only for the step 0 parser, the
   verification commands resolved here, the diff inspection in step 3, or a
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
5. Stop on an evidence-changing blocker. A rejected or modified item may be
   retried at most twice with its failure and current diff supplied as context.

Completion means every ordered item has implementation and verification
evidence, or the report names the exact blocker, skipped check, and resume
action.

## Implementation options

- `--plan[=<model>:<effort>]` explicitly requests a pre-implementation planner
  consult on supported implementation-class routes.
- `--worker=<claude|codex|agy|auto>` selects the Worker Selector and preserves
  the existing worker-routing enum.
- `--worker-target=<provider>/<model>[:<effort>]` selects an explicit
  Provider/Model/Effort Execution Target. It is distinct from `--worker` and
  is not an alias for the selector.
- `--cross-provider` permits the explicitly selected provider boundary when
  the surrounding policy and evidence allow it.
- `--reasoner=<provider>/<model>[:<effort>]` requests a bounded second opinion
  with a Provider-scoped target; canonical Role remains `reasoner`.
- `--architect` or `--no-architect` controls the architecture pass.
- `--codex` is a retired diagnostic and produces a blocking report; it never
  grants a peer, backend, or execution shortcut.

These options refine confirmed implementation work; they do not change its
owner or completion contract.

Host support: on Claude Code, `--worker=codex|agy`, a `codex`/`agy`
`--worker-target`, and `--reasoner=codex` are blocked at parse time because
its subagents cannot receive the dispatcher-attested
`DHPK_CLI_TRANSPORT_CONTEXT`; use `--worker=claude` or `--reasoner=claude`.
The `--plan` effort is not applied there either: the planner runs at its
configured effort and the parser reports that as a notice.

## Output

Report the ordered work items, changed files, tests and static checks, retry
state, unresolved risks, and next handoff. Mark missing evidence as `BLOCKED`
or `NOT RUN`. Keep implementation, verification, and archive as separate
states.

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
- `skills/flow-guide/SKILL.md` — optional separately invoked route guidance;
  Flow Drive does not load it as a prerequisite.
- An optional consumer-project writing-for-agents guide may be supplied when the
  confirmed change edits agent-facing instructions. A missing optional input
  does not authorize an ambient parent lookup.

## Verification

- [ ] A confirmed specification or change identifier was supplied.
- [ ] Repository context and verification commands were read before edits.
- [ ] Work was ordered by dependency and each item has observable evidence.
- [ ] Retried items stay within the two-attempt ceiling.
- [ ] OpenSpec task state, unresolved blockers, and next handoff are explicit.
