# Execution Policy Kernel

This is the short, always-visible safety kernel. Read it before loading a
conditional stack, version, review, or OpenSpec reference. The full policy in
[`execution-policy.md`](./execution-policy.md) remains the single source of
truth for routing precedence, dispatch selection, and reviewer closure; this
file does not duplicate its tables.

## Safety and authorization

- Work only in the user-authorized repository, files, and task scope. A new
  external side effect, provider, message, or materially different target
  needs explicit authorization.
- Preserve existing dirty worktree changes. Do not reset, checkout, stash,
  delete, overwrite, or auto-commit user work; report ownership ambiguity
  before editing an overlapping path.
- Treat secrets, credentials, tokens, private account identifiers, and raw
  user data as redacted evidence. Do not paste them into logs, prompts, or
  generated artifacts.

## Invocation and route boundary

Command entry points parse flags once through the immutable
`scripts/lib/route-result.js` boundary. Downstream policy consumes that route
result and must not reconstruct precedence from the cleaned query. The target
invocation class still applies: an `explicit-only` target is presented with
its exact command form rather than called through a delegated Skill handoff.

## Completion boundary

Do not claim completion from intent, a successful dispatch call, or a source
scan alone. Completion requires the requested scope, actual verification
evidence, and an explicit record of skipped, unavailable, blocked, or
environment-dependent checks. A pending reviewer, unresolved gate, or
unverified runtime premise remains open.

## Conditional references

Load only the references needed by the selected route:

- `execution-policy.md` — routing, dispatch, review, git, and escalation SSOT.
- `skills/dhpk-execution-policy/references/invocation-precedence.md` — target
  classes and invocation ordering.
- `skills/dhpk-execution-policy/references/implementation-dispatch.md` —
  worker selection, premise gates, retries, and evidence contracts.
- `skills/dhpk-execution-policy/references/review-gate-mechanics.md` —
  sentinel lifecycle and fresh reviewer artifacts.
- Stack/version trap sheets and OpenSpec references — only when the selected
  route requires them.
