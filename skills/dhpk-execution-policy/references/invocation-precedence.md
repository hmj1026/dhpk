# Invocation precedence (SSOT)

Canonical precedence for entry selection across dhpk's surfaces
(`openspec/changes/clarify-dhpk-skill-invocation-policy`). `commands/do.md`,
`skills/dhpk-next-step/SKILL.md`, and `rules/execution-policy.md` reference this
file — they do not restate it.

## Fixed order

1. Exact explicit command or skill invocation (the user typed the supported
   syntax, or gave an exact canonical identifier with an imperative request
   on a harness that supports that form).
2. Explicit arguments/options attached to that entry.
3. An explicit `/dhpk:do` request and its matched route.
4. A `dhpk-next-step` recommendation.
5. Model selection among `implicit-eligible` skills.
6. Implementation dispatch, after the selected workflow reaches its
   implementation phase (see `implementation-dispatch.md` — a separate
   concern that starts only once a workflow is already chosen).

A lower-numbered layer never yields to a higher-numbered one: a named,
directly-invoked skill wins over a route-table pattern match; a route-table
match is not re-classified by natural language; implementation dispatch never
decides which workflow owns the request.

## Explicit Invocation

Explicit Invocation requires an exact supported command/skill syntax, or an
exact canonical identifier (`$<skill-name>`) with an imperative request when
the active harness supports that form. Discussing a workflow, or prose that
merely resembles a task the workflow could do, is not Explicit Invocation —
the model may explain or recommend, but does not invoke.

## Invocation-class gate (routers)

Every distributed entry carries `metadata.dhpk-invocation-class`:
`explicit-only` or `implicit-eligible` (full classification and rationale:
`invocation-classification.md`). An explicitly-invoked router — `/dhpk:do`,
`next-step --go` — receives Explicit Routing Delegation to select ONE primary
workflow. Before invoking that workflow through the Skill tool:

- **Target is `implicit-eligible`** → invoke it normally.
- **Target is `explicit-only`** → do NOT call the Skill tool. Print the
  target's exact supported invocation syntax and stop. This holds even when
  the router's own matching (route-table pattern, `dhpk-next-step`'s confidence
  score, a self-classification) is high-confidence — confidence in the
  ROUTE is not authorization to bypass the TARGET's own invocation
  restriction. Both harnesses enforce `explicit-only` at the target; an
  upstream router cannot transfer that runtime authorization to itself.

An explicitly-invoked workflow MAY still invoke `implicit-eligible` skills or
agents needed to fulfill its own explicit contract (e.g. dispatching a code
reviewer). It must NOT invoke a second `explicit-only` workflow — that edge
always resolves to presenting the second workflow's exact invocation.

## OpenSpec entry-point mapping

See `invocation-classification.md`'s design-decision cross-reference and
`openspec/changes/clarify-dhpk-skill-invocation-policy/design.md` decision 9
for the full table. Summary: `/opsx:*` (human Claude command) →
`openspec-*` (Claude Skill tool ID) → `$dhpk:openspec-*` (dhpk Codex surface)
→ `$openspec-*` (verified standalone local Codex surface only). A dhpk-owned
router or prompt never passes an `opsx:*` alias to the generic Skill tool.
