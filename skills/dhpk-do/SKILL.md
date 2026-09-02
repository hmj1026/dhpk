---
name: dhpk-do
argument-hint: '[--route-only] [--codex (deprecated)] [--plan[=<model>[:<effort>]]] [--worker=<claude|codex|agy|auto>] [--reasoner=<claude|codex>[:<model>[:<effort>]]] [--execute-explicit] [--openspec|--opsx] <task>'
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
retired Codex-MCP surface is not a route target: no MCP-backed skill or command
is auto-called, and the retained `codex-review` command uses the explicit CLI
backend. Legacy command names remain explicit-only deprecation aliases with an
exact backend-neutral replacement; the `check-coverage` alias remains outside
the frozen command count until its own retirement is published.

## When NOT to Use

- The target is already known — invoke that skill, command, or agent directly.
- Bypass a target's `explicit-only` invocation class.
- Duplicate or rewrite execution-policy decisions.
- Edit external `/opsx:*` packages or their generated metadata.
- Policy lookup only — use `dhpk-execution-policy`.

## Primary path

1. Parse the argument vector through `scripts/route-result.js`. Strip
   recognized flags, including `--route-only`; keep the cleaned query. A retired
   `--codex` flag is stripped, emits `DEPRECATED_CODEX_FLAG`, and blocks before
   route selection.
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
one-use authority for an explicit-only target. `--plan`, `--worker`,
`--reasoner`, and `--openspec`/`--opsx` are opt-in and must not remain in the
cleaned query. `--codex` is retired: it never enables a peer and is never
silently reinterpreted as `codex exec`, `--worker=codex`, `--reasoner=codex`, or
the external app-server plugin. Its only outcome is a blocking
`DEPRECATED_CODEX_FLAG` diagnostic. Use `/dhpk:do <task>` for the default route,
`--worker=codex` for a deliberate CLI worker, `--reasoner=codex` for a deliberate
CLI reasoning pass, or a named owner's `--second-opinion=codex-exec` for an
additive one-shot second opinion.

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
- [ ] Rejected retired `--codex` with `DEPRECATED_CODEX_FLAG`; did not map it to
      a peer, worker, reasoner, CLI second opinion, or app-server route.
- [ ] Did not bypass the target's invocation class or edit `/opsx:*`.
- [ ] Left host adapters thin: `/dhpk:do`, Cursor pointers, Codex `$dhpk-do`.
