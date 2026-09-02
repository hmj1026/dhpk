---
name: dhpk-do
argument-hint: '[--route-only] [--codex] [--plan[=<model>[:<effort>]]] [--worker=<claude|codex|agy|auto>] [--reasoner=<claude|codex>[:<model>[:<effort>]]] [--execute-explicit] [--openspec|--opsx] <task>'
description: 'Portable single-entry router for dhpk work across Claude, Cursor, and Codex. Not for: bypassing a target invocation class, duplicating execution-policy, or editing external /opsx:* packages. Output: one typed route result and a terminal PASS, BLOCKED, UNAVAILABLE, or explicit-required stop.'
disable-model-invocation: true
metadata:
  dhpk-invocation-class: explicit-only
---

# Do

Route one natural-language task to one dhpk workflow. `/dhpk:do` (Claude) and
Cursor adapters are thin pointers at this skill; the Codex entry is `$dhpk-do`.

Decision SSOT is `rules/execution-policy.md` (and its kernel). Do not copy
dispatch tables into this file. Skill-local routing SSOT is
`references/route-table.json` plus `references/route-result.schema.json`.
Use `scripts/pre-route.sh` and `scripts/route-result.js`; do not invent a
second matcher, parser, or dispatch table.

The default Claude discovery artifact is the inventory-derived materialized
`minimal` profile; `full` and `compat-v1` are explicit opt-in artifacts. The
frozen Codex boundary is 9 MCP-backed skills plus an 8-command compatibility
family, all `explicit-only`; only the canonical `codex-review` command directly
declares MCP tools and aliases forward to their targets. Route
through the execution-policy SSOT and never auto-call that set. The
`check-coverage` explicit-only legacy alias is outside the frozen eight-command
count.

## When NOT to Use

- The target is already known — invoke that skill, command, or agent directly.
- Bypass a target's `explicit-only` invocation class.
- Duplicate or rewrite execution-policy decisions.
- Edit external `/opsx:*` packages or their generated metadata.
- Policy lookup only — use `dhpk-execution-policy`.

## Primary path

1. Parse the argument vector through `scripts/route-result.js`. Strip
   recognized flags, including `--route-only`; keep the cleaned query.
2. Match the cleaned query with `scripts/pre-route.sh` against
   `references/route-table.json` (first match wins). `--route-only` reports
   the typed result and must not invoke the target Skill.
3. Apply execution-policy for dispatch, invocation class, planner, and OpenSpec
   gates. Do not restate policy tables here.
4. Check host availability (Claude / Cursor / Codex) before calling the target.
5. Emit one typed route result that validates against
   `references/route-result.schema.json`.
6. Stop on one terminal: PASS, BLOCKED, UNAVAILABLE, or explicit-required.

`--route-only` classifies and reports without invoking. `--execute-explicit` is
one-use authority for an explicit-only target. `--codex`, `--plan`, `--worker`,
`--reasoner`, and `--openspec`/`--opsx` are opt-in and must not remain in the
cleaned query. `--codex` is a legacy, per-session MCP-peer interface retained
during the capability-migration window; it is not silently reinterpreted as CLI
`codex exec`, `--worker=codex`, `--reasoner=codex`, or the external
`codex app-server` plugin. New work should use the default Codex-free route or
explicitly select the retained CLI backend.

## Output

One `dhpk.route-result.v2` object (`host`, `cleanedQuery`, `options`, `target`,
`availability`, `backendSelection`, `diagnostics`, `disposition`) and a matching
terminal stop:

```text
PASS | BLOCKED | UNAVAILABLE | explicit-required
```

`--route-only` yields disposition `route-only` and must not invoke the target.
Completion is the typed result plus that stop — not a plan, not an applied
change, and not an archive. Handoff is the selected target after a `ready`
disposition, or the exact invocation syntax after `explicit-required`.

## Verification

- [ ] Used `references/route-table.json` and `references/route-result.schema.json`
      as the skill-local SSOT.
- [ ] Pointed at execution-policy for dispatch decisions; did not duplicate a
      policy table.
- [ ] Emitted one typed route result and one terminal PASS, BLOCKED,
      UNAVAILABLE, or explicit-required stop.
- [ ] Did not bypass the target's invocation class or edit `/opsx:*`.
- [ ] Left host adapters thin: `/dhpk:do`, Cursor pointers, Codex `$dhpk-do`.
