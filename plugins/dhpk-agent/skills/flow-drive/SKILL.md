---
name: flow-drive
description: "Explicitly route a task or implement a confirmed specification through the portable DHPK workflow for ordered delivery and bounded verification. Not for architecture-only advice, post-hoc review, or debugging without a confirmed cause. Output: one typed route or implementation handoff with evidence and a terminal state."
metadata:
  dhpk-invocation-class: "explicit-only"
---

# Flow Drive

Use `$flow-drive` when the user explicitly wants a task routed or a confirmed
specification implemented. Select one mode before acting; keep the route and
implementation contracts separate.

## When NOT to Use

- Decide a route without changing files → use `flow-guide`.
- Review an existing change → use `change-verdict`.
- Trace an unfamiliar failure → use `code-trace`.

## Modes

| Mode | Use when | Completion criterion |
|---|---|---|
| `route` | The task still needs one workflow or owner selected. | A typed route result names one target, one availability state, and one terminal disposition. |
| `implement` | The specification and target are sufficiently clear to change files. | Every ordered item has implementation and verification evidence, or an explicit blocker. |

## Route mode

Use the bundled route artifacts as the only skill-local routing source of truth:

1. Parse flags and cleaned task text with `scripts/route-result.js`.
2. Run `scripts/pre-route.sh` against `references/route-table.json`; the first
   matching rule wins. A `NO_MATCH` result goes to deliberate classification,
   not a guessed target.
3. Apply the repository execution-policy for invocation class, planner,
   worker, reasoner, host availability, and OpenSpec gates. Do not duplicate
   that policy in this skill.
4. Use `--route-only` for classification without invoking the target. Use
   `--execute-explicit` only when the selected target is explicit-only.
5. Validate the object against `references/route-result.schema.json` and emit
   one terminal state: `PASS`, `BLOCKED`, `UNAVAILABLE`, or `explicit-required`.

The route result is a handoff, not an implementation, archive, commit, or
release. Treat the retired `--codex` flag as a blocking diagnostic; it never
selects an implicit peer or backend.

## Implement mode

### Parse and order

Read `--spec` when supplied; otherwise use the request as the specification.
If the requirement, target, or reference context is missing, stop with the
minimum missing facts. Break the work into dependency-ordered observable items
before editing. For OpenSpec changes, preserve task order and leave unchecked
items unchecked until their evidence exists.

### Gather context

Read the applicable `AGENTS.md`/`CLAUDE.md`, target and context files, nearby
implementations, relevant tests, and the repository's verification commands.
Record constraints, interfaces, data flow, and edge cases before handing work
to an optional backend. Preserve unrelated dirty work.

### Deliver incrementally

For each item, write a non-tautological test at the public seam when behavior
changes, run it RED, make the smallest compatible change, inspect the diff,
and run the focused checks. Keep optional CLI or AGY workers explicit; the
current model remains the primary implementer. Never edit external `/opsx:*`
packages or their generated metadata.

### Retry and hand off

Classify each item as accepted, rejected, or modified. A rejected or modified
item may be retried at most twice with its failure and current diff supplied as
context; after that, stop with a blocker. Run the designated review and
verification checks after the implementation batch. A second opinion is
additive evidence, never a hidden fallback.

## Output

### Route

Emit the validated `dhpk.route-result.v2` object with `host`, `cleanedQuery`,
`options`, `target`, `availability`, `backendSelection`, `diagnostics`, and
`disposition`, followed by one terminal state.

### Implement

Report the ordered work items, files changed, tests and static checks run,
retry state, unresolved risks, and the next handoff. Mark missing evidence as
`BLOCKED` or `NOT RUN`; do not call a focused check deployment, pilot, release,
or archive proof.

## References

- `references/route-table.json` — high-precision route matcher.
- `references/route-result.schema.json` — typed route-result contract.
- `scripts/pre-route.sh` and `scripts/route-result.js` — deterministic parser and matcher.

## Verification

- [ ] Exactly one mode was selected and its completion criterion is satisfied.
- [ ] Route mode used the bundled table, parser, and schema without a duplicate matcher.
- [ ] Implement mode ordered work by dependency and captured context before edits.
- [ ] Tests and checks have actual command/result evidence; skipped checks have a reason.
- [ ] Invocation classes, optional backends, OpenSpec boundaries, and retry limits were preserved.
