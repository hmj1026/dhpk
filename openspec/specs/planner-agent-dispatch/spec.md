# planner-agent-dispatch Specification

## Purpose

Define planner consult selection, bounded evidence budgets, and compatible
verdict and review contracts across supported Hosts.

## Requirements

### Requirement: Planner consult requests use the caller's supported interface

Planner consults SHALL be requested through a supported caller's declared
interface. Flow Drive SHALL remain task/help only and SHALL NOT expose a
planner selector, consult-scope option, or planner model override. The planner
consult contract SHALL remain independent of its critique, blind-sketch,
dual-plan, warm-review, and cold-review work modes.

#### Scenario: A supported caller explicitly requests a consult

- **WHEN** a supported caller explicitly requests a planner consult
- **THEN** the request reaches planner with the caller-provided scope, or an
  explicit unspecified scope when none was provided

#### Scenario: Flow Drive remains task/help only

- **WHEN** Flow Drive receives a task input or `--help`
- **THEN** it performs its native task/help contract and does not parse a
  planner selector

### Requirement: Orchestrator selects consult scope from named evidence

REQ-2 and REQ-3: The orchestrator SHALL treat an enabled legacy handoff missing
mode as `auto`. For auto, it SHALL select bounded only when the consult
question and intended outcome are clear, the named sources are sufficient to
answer within four direct reads including every mandatory role-protocol read,
and no named Material Risk Signal is present; otherwise it SHALL select
discovery. Signals SHALL use the
accepted named categories: irreversible/external actions; security, privacy,
authentication or money; database/schema/migration; public contract, release or
compatibility; cross-domain/shared-state/multi-writer work; and high uncertainty,
unknown root cause or failed verification. Parser grammar SHALL NOT decide
these conditions or introduce a risk score.

An explicitly provided bounded or discovery scope SHALL take precedence over
auto selection.
Explicit bounded SHALL disclose any overridden signal. Consult scope SHALL be
distinct from the planner's critique, blind-sketch, dual-plan, warm-review, and
cold review-only work modes. Current planning applicability SHALL remain
outcome-based: adequate existing planning evidence SHALL be reusable, and a
supported explicit consult request SHALL still request the consult. Task/file
count SHALL NOT independently require planning.
Scope selection SHALL NOT waive an authorization boundary, unresolved write
prerequisite, or required specialist decision.

A direct planner brief without a selected scope MAY use the existing
discovery allowance when additional context is necessary. Planner SHALL
disclose that scope is unspecified and selection context is missing; it SHALL
NOT infer consult scope from work mode.

#### Scenario: Complete named facts select bounded

- **WHEN** auto receives a clear consult question and intended outcome, named
  sources sufficient within four reads including mandatory protocol reads,
  and no signal
- **THEN** the orchestrator selects bounded and records all three conditions

#### Scenario: Each missing condition selects discovery

- **WHEN** auto lacks a clear consult question or intended outcome, its named
  sources cannot answer within four reads including mandatory protocol reads,
  or it has a signal
- **THEN** the orchestrator selects discovery and names the unmet condition

#### Scenario: Explicit bounded overrides a signal

- **WHEN** bounded is explicitly selected and compatibility risk is present
- **THEN** the orchestrator selects bounded and reports the overridden signal

#### Scenario: Explicit discovery remains discovery

- **WHEN** discovery is explicitly selected for a facts-complete brief
- **THEN** the orchestrator retains discovery

#### Scenario: Legacy enabled handoff is consumed

- **WHEN** an instruction-level consumer receives an enabled plan without mode
- **THEN** it applies auto selection without changing the existing handoff schema

#### Scenario: A sufficient plan and an explicit consult are distinguished

- **WHEN** a sufficient existing plan covers the required outcome
- **THEN** it is reusable without a duplicate consult unless a supported
  explicit request asks for the consult

#### Scenario: Legacy direct brief has no selected scope

- **WHEN** planner receives a direct brief without a selected scope and needs
  additional context
- **THEN** it may use the existing discovery allowance and discloses
  unspecified scope and missing selection context without deriving scope
  from its work mode

### Requirement: Consult scope and actual evidence are reported

REQ-6: The orchestrator SHALL report requested and selected scope, selection
source (`explicit` or `auto`), reason, overridden signals, read/child budgets,
actual reads/children, and blockers. Planner SHALL supply actual read/child
counts and blockers within the existing verdict-first, token-capped,
`END`-terminated reply. Unobserved actual counts SHALL be null with `NOT_RUN`
or `UNAVAILABLE`; planned maxima SHALL NOT be reported as observed usage.
Native quality, cache-token totals, billing, or savings SHALL NOT be inferred
from static guidance or fixture checks.

#### Scenario: Observed consult reports its scope and use

- **WHEN** a bounded consult completes with three reads and zero children
- **THEN** the report identifies bounded, its selection reason and 4/0 budget,
  actual 3/0 use, and any blocker

#### Scenario: Consult has not been observed

- **WHEN** only source or package evidence is available
- **THEN** actual use stays null with `NOT_RUN` or `UNAVAILABLE` and the report
  does not claim native quality, token savings, or billing proof

### Requirement: Planner reply contract — verdict-first-line, coded findings, token cap, END sentinel

Every reply from `dhpk:planner` SHALL begin with a `VERDICT:` line as the first line of the reply: for a pre-implementation plan consult the verdict SHALL be one of `ENDORSE`, `AMEND`, `REPLACE`; for a post-implementation warm review the verdict SHALL be one of `SHIP`, `FIX-THEN-SHIP`, `RECONSULT`. Findings SHALL use the coded vocabulary (NIL/BOUND/RACE/AUTHZ/VALID/ERRPATH/INVARIANT/LEAK/TYPE/DEADCODE/REGRESS/PERF for code-level findings; SEQ/SCOPE/SIMPLER for plan-level findings; `FREE:` as a catch-all for findings outside the coded vocabulary), reported by exception. The total reply SHALL NOT exceed 400 tokens. The literal string `END` SHALL be the last line of every reply. A reply missing the trailing `END` line SHALL be treated by the dispatching orchestrator as truncation: the orchestrator SHALL re-consult `dhpk:planner` exactly once, and if the re-consult also lacks `END`, SHALL proceed with a disclosed degradation notice (stating the reply could not be confirmed complete) rather than silently trusting a possibly-truncated verdict.

#### Scenario: Plan-consult verdict vocabulary

- **WHEN** `dhpk:planner` responds to a pre-implementation plan critique, blind-sketch, or dual-plan consult
- **THEN** the first line of the reply is `VERDICT: ENDORSE`, `VERDICT: AMEND`, or `VERDICT: REPLACE`

#### Scenario: Warm-review verdict vocabulary

- **WHEN** `dhpk:planner` responds to a post-implementation warm diff review
- **THEN** the first line of the reply is `VERDICT: SHIP`, `VERDICT: FIX-THEN-SHIP`, or `VERDICT: RECONSULT`

#### Scenario: Reply ends with the literal END sentinel

- **WHEN** any `dhpk:planner` reply completes normally
- **THEN** the last line of the reply is the literal string `END`

#### Scenario: Missing END triggers one re-consult then disclosed degradation

- **WHEN** a `dhpk:planner` reply is received without a trailing `END` line
- **THEN** the orchestrator re-consults `dhpk:planner` exactly once; if the re-consult also lacks `END`, the orchestrator proceeds with a disclosed degradation notice instead of silently trusting the possibly-truncated verdict

#### Scenario: Reply stays within the token cap

- **WHEN** `dhpk:planner` composes a reply
- **THEN** the reply reports findings by exception using the coded vocabulary and does not exceed 400 tokens

### Requirement: Plan-brief discipline

Before dispatching planner, the orchestrator SHALL assemble a brief following
conclusions-not-context, within 3.5k tokens, containing intent, the confirmed
task, a file map, and load-bearing excerpts rather than raw exploration. The
brief SHALL identify requested/selected consult scope, selection source and
reason, named sources, material signals including explicit overrides, and the
applicable read/child budget. Its lookup fence SHALL preserve facts already
resolved and restrict bounded consult to the named sources.
The named-source fence SHALL include mandatory role protocol resources.
Every direct planner file read, including such a resource read, SHALL count
toward the selected budget.

#### Scenario: Brief stays within the token budget

- **WHEN** the orchestrator prepares a planner brief
- **THEN** it stays within 3.5k tokens and contains only the decision-bearing
  facts, source map, excerpts, and scope evidence

#### Scenario: Brief contains required fields

- **WHEN** the orchestrator assembles a planner brief
- **THEN** it includes intent, confirmed task, source map, load-bearing excerpts,
  and scope evidence rather than raw exploratory context

#### Scenario: Brief includes a lookup fence

- **WHEN** a planner brief is assembled
- **THEN** it preserves already resolved facts and names the permitted lookup scope

#### Scenario: Bounded brief has a named-source fence

- **WHEN** the selected scope is bounded
- **THEN** the brief names the allowed sources, 4/0 budget, and stop-on-missing
  facts boundary

#### Scenario: Scope and work mode are both identified

- **WHEN** the brief asks for a bounded critique
- **THEN** it identifies bounded consult scope separately from critique work mode

### Requirement: Bounded discovery for planner consults

REQ-4 and REQ-5: Planner SHALL remain read-only and have no inline search tools.
Bounded Consult SHALL use at most four direct reads of sources named in the
brief and zero discovery children. Missing necessary facts, including facts
still unresolved when the read budget is exhausted, SHALL produce an explicit
blocker; planner SHALL NOT upgrade itself to discovery,
search ambient sources, or spawn children to bypass the bound. A later change
of consult scope SHALL require an explicit new request.

Discovery Consult SHALL retain at most twelve direct reads and two read-only
discovery children. Unknown locations SHALL use the Host's permitted read-only
discovery role; unavailable discovery capability SHALL be reported rather than
silently replaced with a write-capable role. Warm review SHALL retain its
separate maximum of four new direct reads, with the selected scope's child
limit still applying. Planner SHALL NOT spawn a write-capable child.

#### Scenario: Bounded consult verifies named evidence

- **WHEN** a bounded consult has sufficient named facts
- **THEN** planner reads only named sources at most four times and spawns no child

#### Scenario: Bounded consult lacks a needed fact

- **WHEN** a verdict needs a fact absent from the named sources
- **THEN** planner reports the missing fact as a blocker without discovering or
  changing scope

#### Scenario: Discovery consult reaches an unknown location

- **WHEN** discovery scope needs a source not located in the brief
- **THEN** planner uses only permitted read-only children within 12/2 limits

#### Scenario: Discovery uses the built-in Explore agent, capped at 2 spawns

- **WHEN** discovery scope on Claude Code requires unknown-location discovery
- **THEN** planner uses the existing built-in read-only Explore role, or its
  permitted read-only fallback, with at most two children

#### Scenario: Direct reads are capped at 12

- **WHEN** planner reads files under discovery consult scope
- **THEN** direct reads do not exceed twelve within the consult

#### Scenario: No write-capable child agent is spawned

- **WHEN** planner requires additional context in either scope
- **THEN** it never spawns a write-capable child and bounded never spawns any child

#### Scenario: Warm review keeps its tighter budget

- **WHEN** planner is manually resumed for warm review
- **THEN** it uses at most four new direct reads and respects the existing
  selected-scope child limit

### Requirement: Model/effort resolution follows Host role configuration

The planner model and effort SHALL resolve from applicable Host role
configuration, then the existing Host/Role default. Flow Drive SHALL NOT add a
per-invocation model/effort override. The canonical Claude planner's default
SHALL remain `opus`/`high`. Existing non-default session announcements and
Host capability limitations SHALL remain; a Host unable to apply the
configured effort SHALL retain its configured effort and disclose that
limitation. Consult mode SHALL NOT change model/effort selection, precedence,
or configured defaults.

#### Scenario: Host role configuration precedes the built-in default

- **WHEN** planner role configuration supplies a valid model and effort
- **THEN** applicable configuration takes precedence over the unchanged Host/Role
  default and existing non-default announcements remain

#### Scenario: Default applies when nothing is overridden

- **WHEN** planner role configuration is not set
- **THEN** the existing Host/Role default applies, retaining opus/high for the
  canonical Claude planner

#### Scenario: Non-default resolution is announced at session start

- **WHEN** applicable planner configuration resolves to non-default values
- **THEN** the existing session-start announcement remains

#### Scenario: Unsupported effort is disclosed

- **WHEN** the Host cannot apply the requested planner effort
- **THEN** it retains the configured effort and reports the existing notice

### Requirement: Planner verdict fold-in and manual review

Pre-implementation `ENDORSE`, `AMEND`, and `REPLACE` SHALL retain existing
fold-in semantics: endorse retains the plan, amend applies the reported
deltas, and replace supplies the alternative. Planner warm or cold review
SHALL remain a manually requested capability under its existing verdict-first,
`END`-terminated protocol. This requirement SHALL NOT restore retired router
continuation machinery or require an automatic warm review for every plan
consult. Consult scope SHALL NOT change review ownership or its four-new-read
budget.

#### Scenario: Plan verdict is folded in

- **WHEN** planner returns `ENDORSE`, `AMEND`, or `REPLACE`
- **THEN** the orchestrator applies the existing keep, delta, or replacement
  meaning within the confirmed work

#### Scenario: Review is explicitly requested

- **WHEN** the user or permitted orchestrator manually requests a warm or cold
  review with its diff and evidence
- **THEN** planner uses the existing `SHIP`, `FIX-THEN-SHIP`, or `RECONSULT`
  review vocabulary and applicable budget

#### Scenario: Consultation completes without a manual review request

- **WHEN** a pre-implementation consult ends and no review is requested
- **THEN** this consult-scope contract does not add automatic router
  continuation or a mandatory second planner dispatch
