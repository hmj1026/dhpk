# Task modes — detailed examples

## Small change

Single-file tweak, no test impact. Example: rename a variable, fix a typo in a doc comment, adjust a log message.

Flow: `inspect → patch`. No plan, no tdd-guide.

## Small bug, known cause

You can describe the bug AND the fix in one sentence. Example: "off-by-one in pagination; should be `>=` not `>`".

Flow: `inspect → tdd-guide RED → patch → tdd-guide verify`. The RED test reproduces the bug; the patch makes it pass.

## Medium change

Touches 2-5 files, requires brief design decision. Example: extract a helper, add a new field with defaults across writes/reads.

Flow: `inspect → brief plan → tdd-guide → patch`. The "brief plan" is 3-5 lines in your reply, not a full openspec change.

## Bug, unknown cause

You can describe the symptom but not the cause. Example: "intermittent 500 on /checkout, no useful stack trace".

Flow: `bug-investigation skill → tdd-guide → patch`. The investigation skill drives gitnexus_impact + log review + hypothesis testing BEFORE writing any code.

## New feature

User asks for a new capability. Example: "add an admin endpoint to export users as CSV".

Flow: `tdd-guide → patch`. Test-first is mandatory for new business behaviour.

## Architecture change

Touches multiple modules or introduces a new pattern. Example: "extract auth into a separate service", "introduce a Repository pattern".

Flow: `architect → tdd-guide → patch`. The architect agent designs cross-module boundaries before any code lands.

## When to use OpenSpec

Default: inline brief plan in your reply. Use `/opsx:new` only when the user explicitly requests spec-driven workflow OR when the change is so cross-cutting that a single PR can't capture it cleanly.
