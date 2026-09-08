# review-gate-retirement-evidence Specification

## Purpose

Defines the evidence a retirement report must contain before it may
recommend retiring a legacy review-safety mechanism, and documents where a
single-maintainer accommodation may apply. This capability was previously
enforced only in code and narrative docs; this spec makes the contract
explicit so a threshold change can be proposed and reviewed against it.

## Requirements

### Requirement: Minimum accepted-outcome sample
The system SHALL refuse to recommend retirement unless the evidence set
contains at least a configured minimum number of distinct, accepted,
telemetry-complete outcomes produced during the CUTOVER phase.

#### Scenario: Sample below minimum
- **WHEN** the evidence set contains fewer accepted CUTOVER outcomes than
  the configured minimum
- **THEN** the retirement report SHALL be `BLOCKED` and SHALL list the
  insufficient-sample condition among its blocking reasons

#### Scenario: Sample meets minimum
- **WHEN** the evidence set contains at least the configured minimum number
  of accepted CUTOVER outcomes and every other requirement in this
  capability is satisfied
- **THEN** the insufficient-sample condition SHALL NOT appear among the
  report's blocking reasons

### Requirement: Independently authorized phase promotion
The system SHALL refuse to recommend retirement unless the accepted outcomes
are bound to a phase-promotion authority receipt that is distinct from, and
not self-issued by, the evidence being authorized.

#### Scenario: Authority missing or unbound
- **WHEN** no valid phase-promotion authority receipt is bound to the
  accepted outcomes, or the binding cannot be verified
- **THEN** the retirement report SHALL be `BLOCKED` and SHALL list the
  missing-authority condition among its blocking reasons

#### Scenario: Authority present and bound
- **WHEN** a valid phase-promotion authority receipt is bound to the
  accepted outcomes and every other requirement in this capability is
  satisfied
- **THEN** the missing-authority condition SHALL NOT appear among the
  report's blocking reasons

### Requirement: Single-maintainer authorization track
For a project with no second independent reviewer available, the system MAY
accept a time-separated, externally-corroborated authorization in place of
the distinct-party authority required by the "Independently authorized
phase promotion" requirement. This track SHALL NOT weaken the requirement
that the authorizing act itself be independent of the moment the evidence
was produced: the same maintainer's authorization is accepted only when it
is issued from a session/identity distinct from the one that produced the
CUTOVER outcomes, after a mandatory cool-down period has elapsed since
those outcomes were produced, and only when corroborated by independently
recorded external CI verification evidence for the same outcomes. This
track is a materially weaker independence guarantee than a distinct human
reviewer and SHALL be labeled as such wherever the report or Decision
Packet describes how the outcomes were authorized.

#### Scenario: Same-session or immediate self-authorization rejected
- **WHEN** a phase-promotion authorization is issued from the same
  session/identity that produced the CUTOVER outcomes it authorizes, or
  before the configured cool-down period has elapsed since those outcomes
  were produced
- **THEN** the retirement report SHALL treat the authorization as
  unbound/invalid for those outcomes and SHALL list the missing-authority
  condition among its blocking reasons

#### Scenario: Self-authorization without independent CI corroboration rejected
- **WHEN** a time-separated self-authorization is present but no
  independently recorded external CI verification evidence corroborates
  the same CUTOVER outcomes
- **THEN** the retirement report SHALL treat the authorization as invalid
  for those outcomes and SHALL list the missing-authority condition among
  its blocking reasons

#### Scenario: Time-separated, CI-corroborated self-authorization accepted
- **WHEN** a phase-promotion authorization is issued from a distinct
  session/identity after the configured cool-down period has elapsed since
  the CUTOVER outcomes it authorizes were produced, and independently
  recorded external CI verification evidence corroborates those same
  outcomes
- **THEN** the retirement report SHALL treat the "Independently authorized
  phase promotion" requirement as satisfied for those outcomes via this
  track, SHALL NOT list the missing-authority condition for them, and SHALL
  record in the Decision Packet that this track (not a distinct human
  reviewer) was used

### Requirement: Executable rollback drill
The system SHALL refuse to recommend retirement unless the evidence set
includes a passed rollback drill demonstrating a reverse phase transition
bound to the same source evidence, followed by a diagnostic observation
confirming the reverted state grants no unsafe clearance.

#### Scenario: Rollback drill missing or failed
- **WHEN** no rollback drill is present, or the rollback drill's identity,
  evidence binding, or diagnostic outcome does not validate
- **THEN** the retirement report SHALL be `BLOCKED` and SHALL list the
  rollback-drill condition among its blocking reasons

#### Scenario: Rollback drill passes
- **WHEN** the rollback drill's identity, evidence binding, and diagnostic
  outcome all validate and every other requirement in this capability is
  satisfied
- **THEN** the rollback-drill condition SHALL NOT appear among the report's
  blocking reasons

### Requirement: Recommendation never self-promotes
Regardless of whether the evidence set satisfies every requirement in this
capability, the system SHALL NOT mutate any migration phase state and SHALL
NOT itself authorize retirement; a passing report SHALL still require a
separately obtained retirement authority before any retirement action is
taken.

#### Scenario: All requirements satisfied
- **WHEN** every requirement in this capability is satisfied
- **THEN** the retirement report SHALL mark `phaseMutationPerformed: false`
  and SHALL mark retirement authority as required separately, rather than
  performing or authorizing retirement itself
