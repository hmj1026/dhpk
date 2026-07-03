# Task modes — worked examples

SSOT for the six change types, their flow, and OpenSpec ask-behavior: `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` "Change classification & OpenSpec routing (SSOT)" table. This file adds concrete scenarios only — it does not restate the table as new normative rules.

## Bug Fix (unknown root cause)

You can describe the symptom but not the cause. Example: "intermittent 500 on /checkout, no useful stack trace".

`bug-investigation` drives gitnexus_impact + log review + hypothesis testing BEFORE writing any code. Ask about OpenSpec (✅ per the SSOT table) — y: `/opsx:new`; n: brief plan → tdd-guide → patch.

## Feature Delivery (cross-module / DDD)

Touches multiple modules or introduces a new pattern. Example: "extract auth into a separate service", "introduce a Repository pattern".

`dhpk:architect` designs cross-module boundaries before any code lands. Ask about OpenSpec (✅ per the SSOT table) — y: `/opsx:new`; n: brief plan → tdd-guide → patch.

## Feature Delivery (normal)

User asks for a new capability, single module. Example: "add an admin endpoint to export users as CSV".

Ask about OpenSpec (✅ per the SSOT table) — y: `/opsx:new`; n: brief plan → tdd-guide → patch. Test-first is mandatory for new business behaviour.

## Bug Fix (known root cause)

You can describe the bug AND the fix in one sentence. Example: "off-by-one in pagination; should be `>=` not `>`".

No OpenSpec ask (❌ per the SSOT table): `inspect → tdd-guide RED → patch → tdd-guide verify`. The RED test reproduces the bug; the patch makes it pass.

## Medium change

Touches 2-5 files, requires brief design decision. Example: extract a helper, add a new field with defaults across writes/reads.

No OpenSpec ask (❌ per the SSOT table): `inspect → brief plan → tdd-guide → patch`. The "brief plan" is 3-5 lines in your reply, not a full openspec change.

## Lightweight Maintenance

Single-file tweak, no test impact. Example: rename a variable, fix a typo in a doc comment, adjust a log message.

No OpenSpec ask (❌ per the SSOT table): `inspect → patch`. No plan, no tdd-guide.
