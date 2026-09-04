## MODIFIED Requirements

### Requirement: Explicit-only entries require direct human invocation

An explicit-only entry SHALL NOT be selected or programmatically invoked by a
model. Advisory routing guidance SHALL NOT instruct a model to call an
explicit-only entry through a generic Skill tool; it SHALL either remain silent
or present the exact supported human command. `flow-drive` SHALL remain
explicit-only and SHALL expose only the confirmed-implementation entry
`$flow-drive <confirmed-spec-or-change-id> [implementation-options]`; it SHALL
not accept a `route` or `implement` mode selector. The advisory `flow-guide`
actions `help`, `route`, `rules`, `next`, and `close` MAY be used for advisory
routing according to their own invocation class. `route --go` MAY produce one
bounded delegation handoff only for an implicit-eligible target and SHALL report
`explicit-required` for an explicit-only target. Setup, installation,
credentials or session configuration, apply, release, commit, push,
pull-request creation, deployment, publication, external-write,
batch-governance, and high-authority orchestration entries SHALL be assigned
reviewed canonical `explicit-only` metadata based on their maximum normal
authority.

#### Scenario: Flow-drive is mentioned without an explicit invocation

- **WHEN** a user describes implementation work but does not directly invoke
  `$flow-drive`
- **THEN** the model may explain or present the command but does not invoke
  `flow-drive` automatically

#### Scenario: User invokes flow-drive with a confirmed specification

- **WHEN** a user directly invokes `$flow-drive` with a confirmed specification
  or OpenSpec change identifier
- **THEN** implementation may run subject to its confirmation, planning,
  worker, review, and verification gates

#### Scenario: Flow-drive receives a removed mode flag

- **WHEN** a user supplies `$flow-drive --mode route` or
  `$flow-drive --mode implement`
- **THEN** parsing fails closed, reports that `flow-drive` is mode-free, and
  points to `$flow-guide route` for routing or `$flow-drive <confirmed-spec>`
  for implementation

#### Scenario: Route-go resolves an explicit-only target

- **WHEN** a user invokes `$flow-guide route --go <task>` and the deterministic
  result names an explicit-only target
- **THEN** the router emits `explicit-required` with the exact human command
  and does not invoke or delegate the target

#### Scenario: Help does not grant implementation authority

- **WHEN** a user invokes `$flow-guide help flow-drive`
- **THEN** the result exposes the usage card and explicit-only classification
  without invoking `flow-drive` or authorizing its implementation path

#### Scenario: Natural language resembles a release workflow

- **WHEN** the user discusses release planning without explicitly asking to run
  the release skill or command
- **THEN** the model may explain or recommend the workflow but does not invoke
  an explicit-only release entry

#### Scenario: User directly invokes an explicit-only skill

- **WHEN** a user supplies the exact supported callable syntax for an
  explicit-only entry
- **THEN** the workflow may run subject to its own confirmation, permission,
  and verification gates

#### Scenario: Lower-authority flag exists

- **WHEN** an entry can commit or publish on one normal path but has a
  read-only flag
- **THEN** its fixed class remains explicit-only

#### Scenario: High-authority entry lacks reviewed metadata

- **WHEN** a high-authority entry has no canonical invocation class
- **THEN** validation reports it as unclassified rather than defaulting it to
  explicit-only

#### Scenario: Advisory hook matches an explicit-only entry

- **WHEN** an advisory hook matches a route whose canonical class is
  `explicit-only`
- **THEN** the hook does not suggest a Skill-tool call and emits the exact
  human invocation syntax when guidance is needed

### Requirement: Explicit-only workflows call only implicit-eligible disciplines automatically

An explicitly invoked workflow MAY invoke implicit-eligible skills or agents
needed for its contract. It SHALL NOT invoke another explicit-only workflow
unless the human invocation carries a reviewed entry-specific delegation.
`flow-guide route --go` is limited to one handoff for a resolved
implicit-eligible target and does not itself execute that target;
authority SHALL NOT cascade, retry through another explicit target, or bypass a
downstream confirmation gate. `flow-drive` SHALL use this same rule while
executing a confirmed specification and SHALL stop with the exact next
invocation when a required explicit-only handoff is reached.

#### Scenario: Confirmed implementation reaches an implicit review discipline

- **WHEN** `$flow-drive` requires an implicit-eligible review or test discipline
- **THEN** it may dispatch that discipline within the confirmed implementation
  scope

#### Scenario: Confirmed implementation reaches an explicit release entry

- **WHEN** `$flow-drive` reaches an explicit release or publication entry
  without reviewed delegation
- **THEN** it presents the exact release invocation and waits without invoking
  or retrying the release entry

#### Scenario: Route-go would cascade into two targets

- **WHEN** `$flow-guide route --go` resolves a route that would require a second
  downstream workflow

#### Scenario: Apply workflow reaches code review

- **WHEN** an explicitly invoked implementation workflow requires an
  implicit-eligible review discipline
- **THEN** it may dispatch that review without a second human invocation

#### Scenario: Workflow wants to start release

- **WHEN** an explicit workflow reaches an explicit release entry without
  reviewed delegation
- **THEN** it presents the exact release invocation and waits

#### Scenario: Router receives one-use delegation

- **WHEN** a human supplies a reviewed one-use delegation for one callable
  explicit target
- **THEN** that target may run once and authority is unavailable to retry,
  fallback, or invoke nested explicit targets
- **THEN** it emits the first handoff and stops rather than cascading authority
