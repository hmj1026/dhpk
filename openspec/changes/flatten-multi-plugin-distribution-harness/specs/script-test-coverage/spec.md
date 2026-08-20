## ADDED Requirements

### Requirement: Tests are owned by public contract layer
The test harness SHALL classify distribution assertions as core Module, Adapter-specific, CLI wire, or repository integration. A public invariant SHALL have exactly one owner unless different client-visible behavior requires separate coverage.

#### Scenario: A duplicate checked-in PASS test is found
- **WHEN** the same structural assertion is covered by a direct CI validator and a non-unique wrapper test
- **THEN** the wrapper assertion is removed and the retained owner verifies the invariant
