---
name: flow-drive
argument-hint: '<task-text|task-file|confirmed-spec-or-change-id> [--cross-provider] [--plan[=<model>:<effort>]] [--plan-mode=auto|bounded|discovery] [--worker=<worker>] [--worker-target=<provider>/<model>[:<effort>]] [--reasoner=<provider>[/<model>[:<effort>]]] [--architect|--no-architect]'
description: 'Explicit-only implementation workflow for one task resolved by the Host into a bounded goal, acceptance contract, and constraints. Not for route selection, standalone review, formal OpenSpec authoring, or release. Diagnosis within a confirmed outcome gates dependent writes. Output: distinct execution and acceptance evidence, or an explicit blocker.'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# Flow Drive

Use `$flow-drive <task-text|task-file|confirmed-spec-or-change-id> [options]`
for one bounded implementation task. The Host resolves that single positional
input into a goal, acceptance criteria, and structured constraints before
dispatch. When ownership is unclear, return an explicit blocker or use the
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
- Commit, release, deployment, or archive authority has not been separately granted.

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

## Portable task runner

The portable runner exports
`runFlowDrive(argv, { host, workdir, authorizationEvidence, recovery })`. It passes the
first positional input unchanged to `host.resolveTask(input, { workdir })`;
the Host supplies a non-empty `goal`, a non-empty `acceptance` array, and a
plain-object `constraints` value. The runner does not classify natural-language
intent. The Host owns interpretation and target coordination, while the
existing dispatch resolver validates the selected target. The runner clones
and freezes the returned task contract before coordination or dispatch.

The complete Skill directory can be installed or moved independently. Required
lookup uses its own `scripts/`, `references/execution-bundle/`, and
`references/cli-dispatch/` resources. Native execution, bound current capability
evidence, coordination, and granted cross-Provider selection use the same public
runner after relocation. Peer skills and a canonical checkout are optional;
the injected Host and any selected external tools remain environment
dependencies. See [portability](references/portability.md) for the copy boundary,
optional evidence, missing independence, and fixture versus runtime claims.

Task constraints default to `authority: "read-only"`. A
`"workspace-write"` task must include non-empty, safe relative
`assigned_files`. The Host supplies `constraints.prompt_evidence` pointing to
the actual input file together with its device, inode, and SHA-256; the runner
checks the file identity and content before dispatch. For raw task text, the
Host must materialize that text as a physical prompt file under its authorized
input-preparation scope before returning the write contract from `resolveTask`.
If the Host cannot provide that file and binding, the writer remains blocked;
the caller can supply a task file instead. Read-only task text requires no
physical prompt file. The runner does not create a prompt file or grant the
Host permission to write one. A canonical task
`provider` constraint takes precedence over legacy target flags. An exact
`--worker-target` grants only its selected Worker Provider/Agent/Model and
optional Effort tuple; it does not authorize that Provider for other Roles.
The dispatch resolver still requires current Host access and capability
evidence. `--cross-provider` only opens the optional Host provider-scope
question. The runner starts with external probing disabled and requests a
scoped capability refresh only after a provider-scope answer or an exact
`--worker-target` grant. Cancellation, no answer, or a Host without the
question callback creates no external grant, so independent native graph work
can continue while external nodes remain blocked.

The Host may return a multi-provider selection, successive selections, or a
plain provider-list answer; each `ANSWERED` result must include a nonblank
`answer_id`. Provider names in unrelated or negative text do not grant access.
The runner keeps only a sanitized answer ID with each grant and does not retain
answer text. It does not ask for model choices. A trusted caller may supply
root-owned `authorizationEvidence`, for example
`{ source: "user-answer", answer_id: "consent-42", providers: ["openai"] }`.
Task files, resolver metadata, coordination decisions, and catalog entries
cannot grant provider permission. Host allowed-provider policy, task provider
and strict-target constraints, and current Host evidence remain binding after
any grant. After side-effect-free coordination, the runner refreshes only the
selected external Provider/Agent/Model/Effort/Role/authority tuples; it never
uses a provider-wide consent to probe every model from that Provider.

The runner executes each admitted item and then its acceptance verifier. Its report
keeps parser, execution, acceptance, and requested/resolved/observed targets
separate. Verification `PASSED` requires successful execution and non-empty
verification evidence; the runner's overall status is `REPORTED`, never an
automatic task `PASS`. Planner, reasoner, and architecture options retain the
legacy grammar, but the portable task runner returns a migration notice
and blocker for those extra roles. Use the legacy Flow Drive procedure for
that advanced path; `--no-architect` remains a notice-only compatibility flag.

An optional `recovery` contract enables bounded attempt recovery for solo and
coordinated tasks. The Host proposes a target through `recover`; shared
authorization, capability resolution, failure policy, and one invocation-wide
retry budget validate every replacement. Interrupted writers retain exclusive
ownership until matching stop evidence and actual scope/diff reconciliation
pass. See [recovery](references/recovery.md) for Host hooks, deadlines,
immutable attempt receipts, and the suspended-writer completion boundary.

When the Host exposes current executable capability evidence, it may include a
`capability_evidence` record or per-node `capability_evidence_records` with a `session_id` and `binding_id` supplied by
the runner's injected executor binding. The shared Dispatch Engine uses that
evidence to resolve a currently executable target even when the shipped model
catalog is stale. Static catalog or documentation declarations cannot create
this evidence; Provider, Target Agent, Model, Role, Effort, Route, and
authority remain separate, and unknown observed Model or Effort values stay
explicitly null. A current bound native Host tool may expose a fixed role or
default selector without an observable Model or Effort. Such a target needs
current Provider, role, authority, and binding proof; strict concrete selectors
and external CLI targets retain their concrete requirements. An `EXPOSED`
selector authorizes invocation without becoming observed identity. Even an
`OBSERVED_AVAILABLE` invocation keeps selector and identity separate; explicit
`observed_model`/`observed_effort` fields require actual observation, and runtime
`observed_target` reports only the executor outcome. Matching
fresh scoped evidence supersedes older matching observations, while
contradictory fresh batches and explicit Host refusals remain blocked.
The runner passes the same session and binding identifiers to the
executor context so evidence cannot be attached to an arbitrary task string.

The Host may return `mode: "coordinated"` with a dependency-ordered `nodes`
graph. Each node inherits the parent authority and write scope; unknown,
duplicate, cyclic, or widened dependencies block the graph before execution.
Independent read-only nodes may run in parallel, while all workspace writers, including scratch proposals, use
the shared Dispatch writer lease so solo and coordinated calls never overlap.
Every node must execute and pass its own verification before the aggregate
acceptance can pass. A reasoner conclusion must carry attributable source,
root-cause, repair, and verification evidence before a dependent writer is
eligible; confidence text or a role name alone is insufficient. Required
independent review needs a distinct observed executor identity. Optional peer
absence alone is not a blocker, but a missing review gate cannot become PASS.
The sanitized DEV QA fixtures in `tests/fixtures/flow-drive/` exercise partial
acceptance: an unknown cause blocks its writer while a separate repaired item
retains tests and independent review evidence. Fixture success does not prove
real DEV, database, Provider runtime, deployment, or merge completion.

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
1. Read the confirmed task text/file and any applicable specification or change artifacts in order. Resolve
   repository instructions, context, target files, nearby tests, and the
   verification commands before editing. When the Host has dedicated
   file-reading and search tools (on Claude Code: Read, Grep, Glob), use them
   for this discovery, and run shell commands only for the step 0 parser, the
   verification commands resolved here, the diff inspection in step 3, the
   selected CLI dispatch and availability checks described in
   `references/parent-cli-dispatch.md`, or a command the current grant lists. On a Host without such tools, use its
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
- `--cross-provider` opens the optional Host provider-scope question; the flag
  alone grants no provider access. An explicit `--worker-target` is limited to
  that Worker tuple, while a Host answer grants only the selected Providers.
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

Report the ordered work items, changed files, tests and static checks, retry
state, unresolved risks, and next handoff. For a planner consult, include the
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

## Verification

- [ ] A confirmed specification or change identifier was supplied.
- [ ] Repository context and verification commands were read before edits.
- [ ] Work was ordered by dependency and each item has observable evidence.
- [ ] Retried items stay within the two-attempt ceiling.
- [ ] OpenSpec task state, unresolved blockers, and next handoff are explicit.
