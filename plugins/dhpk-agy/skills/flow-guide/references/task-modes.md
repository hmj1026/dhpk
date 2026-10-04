# Task modes — worked examples

SSOT for the six change types, their flow, and OpenSpec ask-behavior: `_dependencies/rules/execution-policy.md` "Change classification & OpenSpec routing (SSOT)" table. This file adds concrete scenarios only — it does not restate the table as new normative rules.

## Bug Fix (unknown root cause)

You can describe the symptom but not the cause. Example: "intermittent 500 on /checkout, no useful stack trace".

`code-trace` drives gitnexus_impact + log review + hypothesis testing BEFORE writing any code when the cause is not established. Reuse a sufficient diagnosis or evidence report; continue only when root cause and the safe repair are settled. Ask about OpenSpec when its acceptance or task outcomes are still missing (✅ per the SSOT table) — y: `/opsx:new`; n: resolve only the remaining planning gap, then use the applicable test-first implementation path.

## Feature Delivery (cross-module / DDD)

Touches multiple modules or introduces a new pattern. Example: "extract auth into a separate service", "introduce a Repository pattern".

Consult `dhpk:architect` when cross-module boundaries remain undecided before code lands; reuse an approved design when it already settles them. Ask about OpenSpec when acceptance or task outcomes remain missing (✅ per the SSOT table) — y: `/opsx:new`; n: resolve only the remaining gap, then use the applicable test-first implementation path.

## Feature Delivery (normal)

User asks for a new capability, single module. Example: "add an admin endpoint to export users as CSV".

Ask about OpenSpec when the behavior or acceptance boundary is not already settled (✅ per the SSOT table) — y: `/opsx:new`; n: reuse adequate existing evidence and resolve only missing outcomes. Test-first remains appropriate for new business behavior; use `tdd-guide` when the test seam or runtime setup needs a separate specialist.

## Bug Fix (known root cause)

You can describe the bug AND the fix in one sentence. Example: "off-by-one in pagination; should be `>=` not `>`".

No OpenSpec ask (❌ per the SSOT table): reuse an established diagnosis, then write and run a regression test before the patch. Use `tdd-guide` when test design, a live integration boundary, or another specific gap needs that specialist.

## Medium change

Has a contained scope but leaves a design, dependency, ownership, or compatibility decision open. Example: extract a helper, add a field with defaults across writes and reads.

No OpenSpec ask (❌ per the SSOT table): inspect existing evidence and state only the missing decision or outcome. A brief plan is useful when needed; task or file count alone does not require one. Apply the relevant test-first path when behavior changes.

## Lightweight Maintenance

Single-file tweak, no test impact. Example: rename a variable, fix a typo in a doc comment, adjust a log message.

No OpenSpec ask (❌ per the SSOT table): `inspect → patch` with targeted verification. Do not add a planning or specialist stage unless an explicit request or newly found risk requires it.
