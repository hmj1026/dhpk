# Invocation precedence

Use this reference when two route owners could match the same request. The
project policy at `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` remains the
normative source; this file explains how the `flow-guide` modes apply it.

## Fixed order

1. An exact user-invoked command or skill identifier.
2. Explicit arguments attached to that entry.
3. An explicit route-table or command selection.
4. A `flow-guide` `next` recommendation.
5. Model selection among implicit-eligible skills.
6. Implementation dispatch after the selected workflow reaches its
   implementation phase.

A lower-numbered layer wins. A route-table match does not reinterpret an exact
skill invocation, and implementation dispatch never decides which workflow
owns a request.

## Explicit invocation

An explicit invocation is an exact supported command or skill syntax, or an
exact canonical identifier with an imperative request on a harness that
supports that form. Discussing a workflow or using similar prose is not an
invocation; recommend it instead.

## Invocation-class gate

Every distributed entry declares `metadata.dhpk-invocation-class` as
`explicit-only` or `implicit-eligible`. When an explicit router delegates to a
target:

- An `implicit-eligible` target may be invoked normally.
- An `explicit-only` target must be shown with its exact supported invocation
  and must not be invoked by the router.

Confidence in a route is not authorization to bypass the target's class. An
explicit workflow may use implicit-eligible skills or agents required by its
contract, but it must stop and present the syntax for a second explicit-only
workflow.

## OpenSpec entry points

Keep the caller's OpenSpec surface intact: a human `/opsx:*` command routes to
the matching OpenSpec artifact workflow, while a plugin skill uses the
validated OpenSpec skill identifier. A DHPK-owned router must not translate an
`opsx:*` alias into an unrelated generic skill call.
