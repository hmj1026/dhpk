# Python review traps

Use the project’s declared Python support floor and runtime configuration. This guidance is host-neutral; consult supplemental project guidance only when it is available. Apply a trap when a changed path or behavior matches its trigger.

## Runtime compatibility

**Trigger:** A change uses new syntax, standard-library APIs, typing features, or dependency behavior.

**Check and act:** Confirm the minimum supported Python version from project metadata, CI, and deployment configuration. Record contradictions as unresolved; assess compatibility against every declared runtime before recommending a change.

**Do not apply when:** The feature is supported by all configured runtimes, or the changed code is explicitly isolated behind a runtime-specific boundary with tests for that boundary.

## Mutable defaults

**Trigger:** A function default is a list, dictionary, set, or another mutable object.

**Check and act:** Python evaluates defaults when defining the function, so a mutable default can retain changes across calls. Trace reads and writes across repeated calls; introduce per-call state only if the contract expects it, and test both omitted and explicit arguments. [Python’s tutorial on default argument values](https://docs.python.org/3/tutorial/controlflow.html#default-argument-values)

**Do not apply when:** The default is immutable, or shared state is deliberate, documented, and covered by caller-visible tests.

## Resource and exception boundaries

**Trigger:** A change acquires a file, lock, temporary resource, session, or other value that needs cleanup, or adds exception handling.

**Check and act:** Follow success, failure, and cancellation paths. Confirm cleanup has a clear owner, the relevant exception remains observable, and a broad handler does not hide failure.

**Do not apply when:** Ownership is explicitly transferred, or a surrounding context manager or lifecycle owner already proves cleanup.

## Async completion

**Trigger:** The change creates tasks, schedules callbacks, or catches cancellation.

**Check and act:** Identify who retains and awaits each task, observes its exception, and handles cancellation cleanup. Preserve cancellation after cleanup unless the contract explicitly requires suppression; Python’s asyncio guidance describes cancellation as part of structured task behavior. [asyncio task cancellation](https://docs.python.org/3/library/asyncio-task.html#task-cancellation)

**Do not apply when:** The framework or a structured task owner clearly tracks completion and propagates errors.

## Framework and specialist handoffs

**Trigger:** The finding depends on framework request lifecycles, authorization, sensitive data, database behavior, or migrations.

**Check and act:** For FastAPI lifecycle or response behavior, use [the FastAPI review traps](fastapi.md). Send security evidence to security-reviewer; query, transaction, or storage concerns to database-reviewer; schema-change concerns to migration-reviewer. Include the affected path and observed behavior.

**Do not apply when:** The concern is a local behavior the current review can verify directly. For prompt content or tool-boundary concerns, use the shared [prompt-defense guidance](../_common/prompt-defense.md) rather than duplicating it here.
