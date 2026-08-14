# tdd-shared-framework-safety Specification

## Purpose
TBD - created by archiving change harden-opsx-apply-dispatch-guardrails. Update Purpose after archive.
## Requirements
### Requirement: TDD workers must not edit shared framework or vendor source
`tdd-guide` and any TDD/debug worker acting under dhpk guidance SHALL NOT temporarily edit shared framework, vendor, package-manager dependency, or externally mounted framework source to reproduce, intercept, or reset behavior. This prohibition applies even when the worker intends to restore the file afterward, because those paths may not be git-tracked by the project under test.

#### Scenario: Shared framework file is not instrumented
- **WHEN** a failing test requires observing a framework event or lifecycle path in a shared framework checkout
- **THEN** the TDD worker uses a test-local probe, subclass, spy, or reflection helper instead of editing the framework source file

#### Scenario: Intended restoration is not an exception
- **WHEN** a TDD worker considers temporarily editing vendor/framework source and restoring it after debugging
- **THEN** the worker treats that as prohibited and chooses a test-local technique instead

### Requirement: Framework-private state resets stay inside tests with teardown restoration
When a test must reset framework-private or static state to make a behavior testable, the reset SHALL be implemented inside the test fixture or test helper and SHALL include teardown restoration where the state can affect later tests. Production code and shared framework/vendor source SHALL remain untouched.

#### Scenario: Private ended flag reset uses test-local reflection
- **WHEN** a Yii-style application ended flag or similar private framework state must be reset between assertions
- **THEN** the test uses reflection or a test helper in the test tree and restores prior state during teardown

#### Scenario: Reset helper is scoped to test code
- **WHEN** a framework-private reset helper is added
- **THEN** it lives under the project's test/support tree or inside the test case, not under the framework or vendor source tree

### Requirement: Verification of shared dependency cleanliness must not hide probe failures
When the orchestrator verifies that shared framework/vendor source was not modified, it SHALL use probes that surface failures. Commands that suppress decisive errors, such as hiding a "not a git repository" result and then reporting success from a wrapper command, SHALL NOT be used as proof of cleanliness.

#### Scenario: Non-git framework checkout is reported honestly
- **WHEN** the shared framework path is not a git repository
- **THEN** the orchestrator reports that git cleanliness cannot prove restoration and uses content, timestamp, checksum, or other explicit evidence instead

#### Scenario: Suppressed command failure is not proof
- **WHEN** a cleanliness probe suppresses stderr or overwrites the command exit status
- **THEN** its success output is not accepted as proof that shared dependency files are clean
