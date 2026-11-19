# Python TDD traps

Use the project’s configured test instructions, Python floor, and test command. This guidance is host-neutral. Consult optional async or framework testing guidance only when the project makes it available.

## Test caller-visible behavior

**Trigger:** A Python change alters a public function, command, route, event, or observable side effect.

**Check and act:** Before implementation, write or update a test from the expected caller-visible behavior and run it. Confirm RED means the test fails at the intended behavioral assertion; a collection, import, or environment failure is not RED evidence. Only after observable RED, make the smallest implementation change and rerun the same test for GREEN. Refactor with the test still green, then run the configured project test command and async plugin when applicable; discover runner and plugin requirements from project configuration and CI.

**Do not apply when:** The change is purely non-behavioral or already covered by a more direct existing contract. Do not add a fixed coverage percentage.

## Isolate fixtures and external state

**Trigger:** Tests touch a database, filesystem, environment, clock, service, or ASGI application.

**Check and act:** Use project fixtures to isolate state. Confirm database setup and teardown cannot reach shared or production data; restore environment changes and dependency overrides; reset files and application state between cases. FastAPI’s documented TestClient covers synchronous request tests; use the project’s configured async ASGI path when a test must await async collaborators directly. [FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/)

**Do not apply when:** The tested behavior is pure and has no external state. Do not introduce a second client or fixture framework solely for preference.

## Cover negative and exceptional behavior

**Trigger:** Validation, authorization, cancellation, persistence, or another failure boundary changes.

**Check and act:** Assert rejected input, the caller-visible error, and any required rollback or cleanup. Where the contract is transactional, inspect the isolated test state after failure rather than asserting only that an exception was raised.

**Do not apply when:** The changed path cannot fail through that boundary or no state can be partially applied.

## Control clock, filesystem, and environment inputs

**Trigger:** Results depend on current time, temporary paths, filesystem contents, locale, or environment variables.

**Check and act:** Pin or inject only the unstable input needed by the test. Verify boundary cases such as expiry, missing files, invalid paths, and absent environment values when those behaviors changed.

**Do not apply when:** The dependency is fixed by the test environment and the test remains deterministic without additional setup.

## Keep optional guidance optional

**Trigger:** The project already provides supplemental pytest, async, database, or ASGI testing instructions.

**Check and act:** Follow the available instructions and runner configuration. Keep examples compatible with the configured Python and plugin versions.

**Do not apply when:** The project does not provide the referenced tool or guidance. Do not invent a plugin requirement or a universal test-count target.
