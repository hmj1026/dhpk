# JavaScript TDD Traps

Use the project’s configured test runner, scripts, and test layout. Apply these checks when JavaScript or TypeScript behavior changes; do not assume a particular framework or create a new runner to satisfy a generic preference.

## Test the observable behavior first

**Trigger → evidence/action:** A feature or bug fix changes an observable contract. Write a failing assertion against the public function, request boundary, rendered behavior, or persisted result before implementation; make it pass with the smallest change, then refactor while the assertion remains. Prefer user-observable output over private helper structure.

**Do not apply when:** The change is documentation-only or a mechanical edit with no behavior change. Keep the exception bounded to the actual change.

## Mock external boundaries

**Trigger → evidence/action:** A test needs network, database, filesystem, clock, random, or process behavior. Replace that external dependency at its boundary with a controlled result, then exercise the production decision logic and error mapping. Keep fixture data local and deterministic.

**Do not apply when:** A pure function already runs deterministically without a dependency, or the actual boundary behavior is the subject of an integration test. Avoid mocking internal collaborators merely to mirror the implementation.

## Await asynchronous outcomes

**Trigger → evidence/action:** The code returns a promise, schedules a callback, or starts a request. Await the operation and its assertions; cover the success path and contract-relevant rejection, timeout, cancellation, or stale-result path. Make the test fail if the async work rejects or never reaches its expected completion. See [Using promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises).

**Do not apply when:** The operation is synchronous and no async boundary is involved. Avoid fixed sleeps when a completion signal or controlled clock can express the contract.

## Isolate each test

**Trigger → evidence/action:** A test mutates environment, timers, mocks, storage, files, database rows, or shared process state. Allocate unique fixture state and restore or remove it in cleanup, including after failure; run the test alone to confirm it does not depend on suite order.

**Do not apply when:** A read-only unit test has no shared state to isolate. Do not mutate a shared database without the project’s authorized test fixture.

## Keep browser journeys separate

**Trigger → evidence/action:** The behavior depends on a real browser journey across pages, navigation, or integrated UI and service boundaries. Keep unit and integration tests focused on their own contract and hand the full journey to the project’s E2E setup. Playwright’s guidance recommends [user-visible assertions and isolated tests](https://playwright.dev/docs/best-practices).

**Do not apply when:** The changed contract is fully represented at a smaller public boundary. Do not substitute an E2E test for focused failure-path coverage.

## Use configured coverage gates

**Trigger → evidence/action:** The task or project configuration sets a coverage threshold. Run that configured gate and report its actual result; add cases for changed decisions and relevant branches.

**Do not apply when:** No project or task threshold exists. Do not impose a universal percentage target.
