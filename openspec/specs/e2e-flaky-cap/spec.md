# e2e-flaky-cap Specification

## Purpose
TBD - created by archiving change harvest-advice-20260711. Update Purpose after archive.
## Requirements
### Requirement: e2e-runner stabilization attempts are hard-capped per flaky spec
The e2e-runner agent SHALL attempt to stabilize a flaky spec at most 3 times; after the third
failed attempt it SHALL quarantine the spec (or record a tolerance adjustment) and report the
outcome, instead of continuing to retry.

#### Scenario: Flaky spec exhausts its attempts
- **WHEN** a spec fails stabilization on the third attempt (e.g. a pixel-tolerance screenshot diff)
- **THEN** e2e-runner quarantines the spec or records a tolerance adjustment, reports the decision with evidence, and stops retrying

#### Scenario: Spec stabilizes within the cap
- **WHEN** a flaky spec passes reliably after the second adjustment
- **THEN** e2e-runner proceeds normally with no quarantine
