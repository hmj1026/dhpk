# FastAPI review traps

Confirm the installed FastAPI, Starlette, and validation-library versions before relying on version-specific behavior. Use the [Python review traps](python.md) for language-level concerns.

## Async and blocking work

**Trigger:** An async path operation or dependency calls synchronous I/O, or code is being converted between synchronous and asynchronous forms.

**Check and act:** Trace the call chain and identify blocking database, filesystem, network, or CPU work. FastAPI documents that normal synchronous path operations and dependencies run in a thread pool, while directly called utilities do not receive that handling. Keep the route form aligned with the libraries it calls. [FastAPI async guidance](https://fastapi.tiangolo.com/async/)

**Do not apply when:** A synchronous route intentionally uses a blocking library, or an async operation is properly awaited. Do not convert every route to async as a style rule.

## Dependency and resource lifetime

**Trigger:** A dependency uses yield, manages a database session or other resource, or is used by streaming or background work.

**Check and act:** Trace setup and cleanup, including exceptions and who still uses the resource after the route returns. Check the installed FastAPI version and dependency scope: current documentation describes request-scoped cleanup after the response by default and a function scope that closes earlier. [Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/)

**Do not apply when:** The dependency has no cleanup responsibility, or its lifetime already covers every consumer. Do not shorten a dependency lifetime if a response stream or task still needs it.

## Request and response contracts

**Trigger:** Request models, validation, response types, or serialization change.

**Check and act:** Verify accepted input, invalid-input behavior, and the documented output shape. FastAPI’s response_model performs output validation and filtering; test that fields outside the intended response are absent. [FastAPI response models](https://fastapi.tiangolo.com/tutorial/response-model/)

**Do not apply when:** A route deliberately returns a raw, streaming, or file response with a separately tested contract. Do not treat input validation as authorization.

## Sensitive response fields

**Trigger:** A response exposes ORM models, nested objects, account data, credentials, or internal fields.

**Check and act:** Inspect the serialized response for each caller class, including unauthorized and error paths. Use explicit response projections where appropriate and send access-control or secret-exposure findings to security-reviewer.

**Do not apply when:** The field is deliberately public under the endpoint contract and tests establish that boundary.

## Timeouts and cancellation

**Trigger:** An endpoint calls another service, holds a resource during awaited work, or creates background tasks.

**Check and act:** Trace timeout configuration, task ownership, cancellation, and cleanup through the upstream call. Recommend a timeout only from the service’s configured deadline or reliability contract; avoid inventing a duration.

**Do not apply when:** The operation has no external wait or resource lifetime at issue. A blanket timeout value is not evidence of a defect.

## Handoffs

**Trigger:** A finding concerns credentials, authorization, data exposure, SQL construction, or transaction ownership.

**Check and act:** Preserve the endpoint, caller, and observed input/output path, then hand off security questions to security-reviewer and persistence or transaction questions to database-reviewer.

**Do not apply when:** The evidence is limited to a local schema or lifecycle behavior that this review can verify.
